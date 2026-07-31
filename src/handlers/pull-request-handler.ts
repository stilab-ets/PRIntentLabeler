import type { Context } from "probot";
import { readPullRequestData } from "../github/pr-reader.js";
import { buildAnalysisComment } from "../comments/build-analysis-comment.js";
import { upsertPullRequestComment } from "../github/pr-commenter.js";
import type { LlmProvider } from "../llm/llm-provider.js";
import {
  createEnvironmentLlmProvider,
  createLlmProvider,
} from "../llm/provider-factory.js";
import { buildPullRequestLlmContext } from "../llm/pr-context.js";
import { filterValidSuggestions } from "../labels/label-policy.js";
import {
  resolveLabelMode,
  selectLabelsToApply,
  selectSuggestedLabelsBelowThreshold,
} from "../labels/label-mode.js";
import { removeLabels } from "../labels/label-applier.js";
import { applyAiSuggestedLabels } from "../labels/ai-label-applier.js";
import { createLabelerCheckRun } from "../github/check-run.js";
import {
  MAX_LABELS_TO_APPLY,
  MIN_CONFIDENCE_TO_SUGGEST,
} from "../utils/constants.js";
import type { PullRequestAnalysis } from "../domain/llm-analysis.js";
import type { LlmUsageMetrics } from "../llm/openai-compatible-provider.js";
import { getLlmConfigurationService } from "../configuration/runtime.js";
import { CLASSIFICATION_PROMPT_VERSION } from "../llm/prompt-builder.js";

export async function handlePullRequestEvent(
  context: Context<"pull_request">,
  providerOverride?: LlmProvider | null,
): Promise<void> {
  const { action, pull_request, repository } = context.payload;

  const logContext = {
    action,
    owner: repository.owner.login,
    repo: repository.name,
    pullNumber: pull_request.number,
  };

  context.log.info(logContext, "Processing pull request event");

  try {
    const prData = await readPullRequestData(context);

    // Préparation intelligente : on score/filtre les fichiers avant l'appel LLM.
    const llmContext = buildPullRequestLlmContext(prData);
    context.log.info(
      {
        ...logContext,
        selectedFilesCount: llmContext.selectedFilesCount,
        summaryOnlyFilesCount: llmContext.summaryOnlyFilesCount,
        // Détail par fichier sélectionné : permet de vérifier immédiatement
        // qu'un lockfile, un snapshot ou un fichier généré n'est jamais
        // réellement envoyé au LLM (seul le rôle "include-patch" doit apparaître).
        selectedFiles: llmContext.selectedFiles.map((ranked) => ({
          filename: ranked.file.filename,
          role: ranked.role,
          score: ranked.score,
          contentPolicy: ranked.contentPolicy,
          reasons: ranked.reasons,
        })),
        estimatedTotalTokens:
          llmContext.promptBudget.finalPromptEstimatedTokens +
          llmContext.promptBudget.responseReserveTokens,
        estimatedNonPatchTokens:
          llmContext.promptBudget.nonPatchEstimatedTokens,
        availablePatchTokens: llmContext.promptBudget.availablePatchTokens,
        allocatedPatchTokens: llmContext.promptBudget.allocatedPatchTokens,
        patchAllocations: llmContext.promptBudget.files,
        truncatedFiles: llmContext.promptBudget.files
          .filter((file) => file.truncated)
          .map((file) => file.filename),
        promptVersion: CLASSIFICATION_PROMPT_VERSION,
      },
      "Filtered LLM context built",
    );

    let analysis: PullRequestAnalysis | null = null;
    let provider: LlmProvider | null;

    // Journalise les jetons réellement facturés par le fournisseur retenu,
    // quel qu'il soit, afin de valider notre estimation locale du budget.
    const onUsage = (usage: LlmUsageMetrics) =>
      context.log.info({ ...logContext, ...usage }, "LLM token usage measured");

    if (providerOverride !== undefined) {
      provider = providerOverride;
    } else {
      const installationId = context.payload.installation?.id;
      const configurationService = getLlmConfigurationService();

      try {
        const configuration =
          installationId && configurationService
            ? await configurationService.resolve(installationId)
            : null;
        provider = configuration
          ? createLlmProvider(configuration, onUsage)
          : createEnvironmentLlmProvider(onUsage);

        if (configuration) {
          context.log.info(
            {
              ...logContext,
              installationId,
              llmProvider: configuration.provider,
              llmModel: configuration.model,
            },
            "Installation LLM configuration loaded",
          );
        }
      } catch (configurationError) {
        provider = null;
        context.log.warn(
          {
            ...logContext,
            installationId,
            error:
              configurationError instanceof Error
                ? configurationError.message
                : configurationError,
          },
          "Failed to load installation LLM configuration",
        );
      }
    }

    if (llmContext.repositoryLabels.length === 0) {
      analysis = {
        suggestions: [],
        summary: "No repository labels are available.",
      };
      context.log.info(
        { ...logContext, promptVersion: CLASSIFICATION_PROMPT_VERSION },
        "No candidate repository labels, skipping LLM classification",
      );
    } else if (provider) {
      try {
        const raw = await provider.classifyPullRequest(llmContext);
        analysis = {
          ...raw,
          suggestions: filterValidSuggestions(
            raw.suggestions,
            llmContext.repositoryLabels,
            MIN_CONFIDENCE_TO_SUGGEST,
            MAX_LABELS_TO_APPLY,
          ),
        };
        context.log.info(
          {
            ...logContext,
            suggestions: analysis.suggestions.map((s) => s.name),
          },
          "LLM label suggestions generated",
        );
      } catch (llmError) {
        context.log.warn(
          {
            ...logContext,
            error: llmError instanceof Error ? llmError.message : llmError,
          },
          "LLM call failed, posting comment without suggestions",
        );
      }
    } else {
      context.log.warn(
        logContext,
        "No LLM configuration available, skipping LLM classification",
      );
    }

    const mode = resolveLabelMode(process.env.LABEL_MODE);
    let appliedLabels: string[] = [];

    if (analysis && analysis.suggestions.length > 0) {
      const toApply = selectLabelsToApply(analysis.suggestions, mode);
      if (toApply.length > 0 || mode === "auto-high") {
        const labelNames = toApply.map((s) => s.name);
        const toRemove =
          mode === "auto-high"
            ? selectSuggestedLabelsBelowThreshold(
                analysis.suggestions,
                prData.pullRequestLabels,
              )
            : [];

        try {
          if (toRemove.length > 0) {
            await removeLabels(
              context.octokit,
              repository.owner.login,
              repository.name,
              prData.number,
              toRemove,
            );
          }
          if (labelNames.length > 0) {
            await applyAiSuggestedLabels(
              context.octokit,
              repository.owner.login,
              repository.name,
              prData.number,
              labelNames,
            );
          }
          appliedLabels = labelNames;
          context.log.info(
            { ...logContext, mode, appliedLabels, removedLabels: toRemove },
            "Labels applied to pull request",
          );
        } catch (applyError) {
          context.log.warn(
            {
              ...logContext,
              mode,
              error:
                applyError instanceof Error ? applyError.message : applyError,
            },
            "Failed to apply labels, keeping suggestions only",
          );
        }
      }
    }

    const commentBody = buildAnalysisComment(
      prData,
      llmContext,
      analysis,
      appliedLabels,
    );
    await upsertPullRequestComment(context, prData.number, commentBody);

    // Boutons d'action (Suggest only / Auto-apply high / Auto-apply all).
    // Échec non bloquant : la permission `checks: write` peut manquer.
    try {
      const checkSummary =
        analysis && analysis.suggestions.length > 0
          ? `${analysis.suggestions.length} label(s) suggéré(s) : ${analysis.suggestions
              .map((s) => s.name)
              .join(", ")}.`
          : "Aucune suggestion de label pour cette PR.";
      await createLabelerCheckRun(context, pull_request.head.sha, checkSummary);
    } catch (checkError) {
      context.log.warn(
        {
          ...logContext,
          error: checkError instanceof Error ? checkError.message : checkError,
        },
        "Failed to create check run (checks:write manquant ?)",
      );
    }

    context.log.info(
      { ...logContext, mode, appliedLabels },
      "Pull request analysis comment published",
    );
  } catch (error) {
    context.log.error(
      {
        ...logContext,
        error: error instanceof Error ? error.message : error,
      },
      "Failed to process pull request event",
    );
  }
}

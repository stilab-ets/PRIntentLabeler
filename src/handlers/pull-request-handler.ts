import type { Context } from "probot";
import { readPullRequestData } from "../github/pr-reader.js";
import { buildAnalysisComment } from "../comments/build-analysis-comment.js";
import { upsertPullRequestComment } from "../github/pr-commenter.js";
import { GroqProvider } from "../llm/groq-provider.js";
import type { LlmProvider } from "../llm/llm-provider.js";
import { buildPullRequestLlmContext } from "../llm/pr-context.js";
import { filterValidSuggestions } from "../labels/label-policy.js";
import { resolveLabelMode, selectLabelsToApply, selectSuggestedLabelsBelowThreshold } from "../labels/label-mode.js";
import { removeLabels } from "../labels/label-applier.js";
import { applyAiSuggestedLabels } from "../labels/ai-label-applier.js";
import { createLabelerCheckRun } from "../github/check-run.js";
import { MAX_LABELS_TO_APPLY } from "../utils/constants.js";
import type { PullRequestAnalysis } from "../domain/llm-analysis.js";

function createGroqProvider(): LlmProvider | null {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL ?? "llama-3.1-8b-instant";
  if (!apiKey || apiKey === "REMPLACER_PAR_VOTRE_CLE") return null;
  return new GroqProvider(apiKey, model);
}

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
        selectedFiles: llmContext.selectedFilesCount,
        ignoredFiles: llmContext.ignoredFilesCount,
      },
      "Filtered LLM context built",
    );

    let analysis: PullRequestAnalysis | null = null;
    const provider =
      providerOverride !== undefined ? providerOverride : createGroqProvider();

    if (provider) {
      try {
        const raw = await provider.classifyPullRequest(llmContext);
        analysis = {
          ...raw,
          suggestions: filterValidSuggestions(
            raw.suggestions,
            prData.repositoryLabels,
            undefined,
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
        "GROQ_API_KEY not configured, skipping LLM classification",
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
                applyError instanceof Error
                  ? applyError.message
                  : applyError,
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
      await createLabelerCheckRun(
        context,
        pull_request.head.sha,
        checkSummary,
      );
    } catch (checkError) {
      context.log.warn(
        {
          ...logContext,
          error:
            checkError instanceof Error ? checkError.message : checkError,
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

import type { Context } from "probot";
import { fetchPullRequestData } from "../github/pr-fetcher.js";
import { findBotComment, upsertComment } from "../github/pr-commenter.js";
import { buildPullRequestLlmContext } from "../llm/pr-context.js";
import { buildAnalysisComment } from "../comments/build-analysis-comment.js";
import { parseAnalysisDataBlock } from "../comments/comment-state.js";
import { removeLabels } from "../labels/label-applier.js";
import { applyAiSuggestedLabels } from "../labels/ai-label-applier.js";
import { toAiLabelName } from "../labels/ai-label-name.js";
import {
  selectLabelsToApply,
  selectSuggestedLabelsBelowThreshold,
} from "../labels/label-mode.js";
import {
  ACTION_APPLY_ALL,
  ACTION_APPLY_HIGH,
  ACTION_SUGGEST,
} from "../github/check-run.js";

// Réagit au clic sur un bouton de la Check Run.
// Le bouton ne fait qu'envoyer cet event : c'est ici qu'on applique réellement.
export async function handleCheckRunRequestedAction(
  context: Context<"check_run">,
): Promise<void> {
  const payload = context.payload as typeof context.payload & {
    requested_action?: { identifier: string };
  };
  const identifier = payload.requested_action?.identifier;
  const checkRun = context.payload.check_run;
  const pr = checkRun.pull_requests?.[0];

  const owner = context.payload.repository.owner.login;
  const repo = context.payload.repository.name;

  const logContext = { owner, repo, identifier, prNumber: pr?.number };

  if (!identifier || !pr) {
    context.log.warn(logContext, "Check run action without PR or identifier");
    return;
  }

  try {
    // On récupère l'analyse stockée dans le commentaire (pas de rappel LLM).
    const existing = await findBotComment(context.octokit, owner, repo, pr.number);
    const analysis = existing ? parseAnalysisDataBlock(existing.body) : null;

    if (!analysis || analysis.suggestions.length === 0) {
      context.log.warn(logContext, "No stored suggestions to act on");
      return;
    }

    const prData = await fetchPullRequestData(
      context.octokit,
      owner,
      repo,
      pr.number,
    );
    const llmContext = buildPullRequestLlmContext(prData);

    let appliedLabels: string[] = [];
    let removedLabels: string[] = [];

    if (identifier === ACTION_SUGGEST) {
      // Pré-coche uniquement les labels déjà présents sur la PR (sous leur
      // forme "🤖 <nom>", celle réellement appliquée par le bot).
      const present = new Set(
        prData.pullRequestLabels.map((l) => l.toLowerCase()),
      );
      appliedLabels = analysis.suggestions
        .map((s) => s.name)
        .filter((name) => present.has(toAiLabelName(name).toLowerCase()));
    } else if (identifier === ACTION_APPLY_HIGH) {
      const toApply = selectLabelsToApply(analysis.suggestions, "auto-high");
      removedLabels = selectSuggestedLabelsBelowThreshold(
        analysis.suggestions,
        prData.pullRequestLabels,
      );
      appliedLabels = toApply.map((s) => s.name);

      if (removedLabels.length > 0) {
        await removeLabels(
          context.octokit,
          owner,
          repo,
          pr.number,
          removedLabels,
        );
      }
      if (appliedLabels.length > 0) {
        await applyAiSuggestedLabels(
          context.octokit,
          owner,
          repo,
          pr.number,
          appliedLabels,
        );
      }
    } else if (identifier === ACTION_APPLY_ALL) {
      const toApply = selectLabelsToApply(analysis.suggestions, "auto-all");
      appliedLabels = toApply.map((s) => s.name);
      if (appliedLabels.length > 0) {
        await applyAiSuggestedLabels(
          context.octokit,
          owner,
          repo,
          pr.number,
          appliedLabels,
        );
      }
    } else {
      context.log.warn(logContext, "Unknown check run action identifier");
      return;
    }

    const body = buildAnalysisComment(prData, llmContext, analysis, appliedLabels);
    await upsertComment(context.octokit, owner, repo, pr.number, body);

    context.log.info(
      { ...logContext, appliedLabels, removedLabels },
      "Check run action handled",
    );
  } catch (error) {
    context.log.error(
      {
        ...logContext,
        error: error instanceof Error ? error.message : error,
      },
      "Failed to handle check run action",
    );
  }
}

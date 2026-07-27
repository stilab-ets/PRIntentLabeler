import type { Context } from "probot";
import { BOT_COMMENT_MARKER } from "../utils/constants.js";
import {
  hasOnlyAiCheckboxLabels,
  parseAnalysisDataBlock,
  parseAllCheckboxLabels,
  parseCheckedLabels,
} from "../comments/comment-state.js";
import { computeLabelChanges } from "../labels/label-sync.js";
import { removeLabels } from "../labels/label-applier.js";
import { applyAiSuggestedLabels } from "../labels/ai-label-applier.js";
import { findBotComment, isCommentOwnedByApp } from "../github/pr-commenter.js";
import { listAllPages } from "../github/pagination.js";

// Réagit à l'édition du commentaire de l'app : quand un mainteneur coche/décoche
// une case, on synchronise les labels de la PR (ajout/retrait symétrique).
export async function handleIssueCommentEdited(
  context: Context<"issue_comment">,
): Promise<void> {
  const { comment, issue, sender, repository } = context.payload;

  const owner = repository.owner.login;
  const repo = repository.name;
  const logContext = { owner, repo, issueNumber: issue.number };

  // Anti-boucle : on ignore les éditions provoquées par l'app elle-même.
  if (sender.type === "Bot") return;

  if (!issue.pull_request) return;
  if (!comment.body.startsWith(BOT_COMMENT_MARKER)) return;
  if (!isCommentOwnedByApp(comment)) return;
  if (!hasOnlyAiCheckboxLabels(comment.body)) return;

  const officialComment = await findBotComment(
    context.octokit,
    owner,
    repo,
    issue.number,
  );
  if (!officialComment || officialComment.id !== comment.id) return;

  const stored = parseAnalysisDataBlock(comment.body);
  if (!stored?.verified || !stored.headSha) return;

  const allLabels = parseAllCheckboxLabels(comment.body);
  if (allLabels.length === 0) return;

  const checked = parseCheckedLabels(comment.body);
  const suggestions = new Set(
    stored.analysis.suggestions.map((suggestion) =>
      suggestion.name.toLowerCase(),
    ),
  );
  if (allLabels.some((label) => !suggestions.has(label.toLowerCase()))) return;

  const [pullRequest, repositoryLabels] = await Promise.all([
    context.octokit.pulls.get({
      owner,
      repo,
      pull_number: issue.number,
    }),
    listAllPages(context.octokit, context.octokit.issues.listLabelsForRepo, {
      owner,
      repo,
      per_page: 100,
    }),
  ]);

  if (pullRequest.data.head.sha !== stored.headSha) return;

  const repositoryLabelNames = new Set(
    repositoryLabels.map((label) => label.name.toLowerCase()),
  );
  if (
    allLabels.some((label) => !repositoryLabelNames.has(label.toLowerCase()))
  ) {
    return;
  }

  const current = (issue.labels ?? []).map((label) =>
    typeof label === "string" ? label : (label.name ?? ""),
  );

  const { toAdd, toRemove } = computeLabelChanges(allLabels, checked, current);

  if (toAdd.length === 0 && toRemove.length === 0) return;

  try {
    await applyAiSuggestedLabels(
      context.octokit,
      owner,
      repo,
      issue.number,
      toAdd,
    );
    await removeLabels(context.octokit, owner, repo, issue.number, toRemove);

    context.log.info(
      { ...logContext, toAdd, toRemove },
      "Synced labels from comment checkboxes",
    );
  } catch (error) {
    context.log.error(
      {
        ...logContext,
        error: error instanceof Error ? error.message : error,
      },
      "Failed to sync labels from checkboxes",
    );
  }
}

import type { Context } from "probot";
import { BOT_COMMENT_MARKER } from "../utils/constants.js";
import {
  parseAllCheckboxLabels,
  parseCheckedLabels,
} from "../comments/comment-state.js";
import { computeLabelChanges } from "../labels/label-sync.js";
import { removeLabels } from "../labels/label-applier.js";
import { applyAiSuggestedLabels } from "../labels/ai-label-applier.js";

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

  // On n'agit que sur notre propre commentaire interactif, et sur une PR.
  if (!issue.pull_request) return;
  if (!comment.body.includes(BOT_COMMENT_MARKER)) return;

  const allLabels = parseAllCheckboxLabels(comment.body);
  if (allLabels.length === 0) return;

  const checked = parseCheckedLabels(comment.body);
  const current = (issue.labels ?? []).map((l) =>
    typeof l === "string" ? l : (l.name ?? ""),
  );

  const { toAdd, toRemove } = computeLabelChanges(allLabels, checked, current);

  if (toAdd.length === 0 && toRemove.length === 0) return;

  try {
    await applyAiSuggestedLabels(context.octokit, owner, repo, issue.number, toAdd);
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

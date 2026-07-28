import type { Context } from "probot";
import { BOT_COMMENT_MARKER } from "../utils/constants.js";
import { listAllPages } from "./pagination.js";

type OctokitLike = Context<"check_run">["octokit"];

export type BotComment = { id: number; body: string };

type CommentIdentity = {
  body?: string | null;
  user?: { type?: string } | null;
  performed_via_github_app?: { id?: number } | null;
};

export function isCommentOwnedByApp(comment: CommentIdentity): boolean {
  if (comment.user?.type !== "Bot") return false;

  const expectedAppId = Number.parseInt(process.env.APP_ID ?? "", 10);
  if (Number.isFinite(expectedAppId)) {
    return comment.performed_via_github_app?.id === expectedAppId;
  }

  return Boolean(comment.performed_via_github_app?.id);
}

export async function findBotComment(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<BotComment | null> {
  const comments = await listAllPages(octokit, octokit.issues.listComments, {
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100,
  });

  const existing = comments.find(
    (comment) =>
      comment.body?.startsWith(BOT_COMMENT_MARKER) &&
      isCommentOwnedByApp(comment),
  );

  return existing ? { id: existing.id, body: existing.body ?? "" } : null;
}

// Crée ou met à jour le commentaire de l'app (upsert via le marker).
export async function upsertComment(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  const existing = await findBotComment(octokit, owner, repo, issueNumber);

  if (existing) {
    await octokit.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
    return;
  }

  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });
}

// Variante pratique pour l'event pull_request (conserve l'API existante).
export async function upsertPullRequestComment(
  context: Context<"pull_request">,
  issueNumber: number,
  body: string,
): Promise<void> {
  const { repository } = context.payload;
  const owner = repository.owner.login;
  const repo = repository.name;

  const existing = await findBotComment(
    context.octokit,
    owner,
    repo,
    issueNumber,
  );

  if (existing) {
    await context.octokit.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
    context.log.info(
      { owner, repo, issueNumber, commentId: existing.id },
      "Updated existing bot comment",
    );
    return;
  }

  await context.octokit.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });

  context.log.info({ owner, repo, issueNumber }, "Created new bot comment");
}

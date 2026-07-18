import type { Context } from "probot";
import type {
  PullRequestData,
  PullRequestFileData,
} from "../domain/pull-request-data.js";
import { isAiLabelName } from "../labels/ai-label-name.js";
import { listAllPages } from "./pagination.js";

type OctokitLike = Context<"check_run">["octokit"];

// Récupère les données d'une PR par son numéro (via l'API), utilisable depuis
// les events qui ne portent pas le payload `pull_request` (check_run, issue_comment).
export async function fetchPullRequestData(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PullRequestData> {
  const [prResponse, rawFiles, rawLabels, rawPrLabels] = await Promise.all([
    octokit.pulls.get({ owner, repo, pull_number: pullNumber }),
    listAllPages(octokit, octokit.pulls.listFiles, {
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    }),
    listAllPages(octokit, octokit.issues.listLabelsForRepo, {
      owner,
      repo,
      per_page: 100,
    }),
    listAllPages(octokit, octokit.issues.listLabelsOnIssue, {
      owner,
      repo,
      issue_number: pullNumber,
      per_page: 100,
    }),
  ]);

  const pr = prResponse.data;

  const files: PullRequestFileData[] = rawFiles.map((file) => ({
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
    patch: file.patch,
  }));

  return {
    owner,
    repo,
    number: pullNumber,
    title: pr.title,
    body: pr.body ?? "",
    author: pr.user?.login ?? "unknown",
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
    htmlUrl: pr.html_url,
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    changedFilesCount: pr.changed_files ?? files.length,
    files,
    repositoryLabels: rawLabels
      .map((label) => label.name)
      .filter((name) => !isAiLabelName(name)),
    repositoryLabelDescriptions: Object.fromEntries(
      rawLabels
        .filter(
          (label) =>
            !isAiLabelName(label.name) && Boolean(label.description?.trim()),
        )
        .map((label) => [label.name, label.description?.trim() ?? ""]),
    ),
    pullRequestLabels: rawPrLabels.map((label) => label.name),
  };
}

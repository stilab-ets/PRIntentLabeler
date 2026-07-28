import type { Context } from "probot";
import type {
  PullRequestData,
  PullRequestFileData,
} from "../domain/pull-request-data.js";
import { isAiLabelName } from "../labels/ai-label-name.js";
import { listAllPages } from "./pagination.js";

export async function readPullRequestData(
  context: Context<"pull_request">,
): Promise<PullRequestData> {
  const { pull_request: pr, repository } = context.payload;
  const owner = repository.owner.login;
  const repo = repository.name;
  const pullNumber = pr.number;

  const [rawFiles, rawLabels, rawPrLabels] = await Promise.all([
    listAllPages(context.octokit, context.octokit.pulls.listFiles, {
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    }),
    listAllPages(context.octokit, context.octokit.issues.listLabelsForRepo, {
      owner,
      repo,
      per_page: 100,
    }),
    listAllPages(context.octokit, context.octokit.issues.listLabelsOnIssue, {
      owner,
      repo,
      issue_number: pullNumber,
      per_page: 100,
    }),
  ]);

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
    headSha: pr.head.sha,
    htmlUrl: pr.html_url,
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    changedFilesCount: pr.changed_files ?? files.length,
    files,
    // On exclut les variantes "🤖 <nom>" déjà créées par le bot : ce ne sont
    // pas des labels de taxonomie à proposer au LLM, seulement des marqueurs
    // visuels générés à partir d'un label existant.
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

/**
 * Inspecte la sélection de fichiers sur une ou plusieurs PR publiques, sans
 * appeler le LLM.
 *
 * Usage:
 *   npx tsx scripts/evaluate-file-selection.ts <PR_URL> [PR_URL...]
 *
 * GITHUB_TOKEN est optionnel, mais recommandé pour éviter la limite anonyme.
 */

import { buildPullRequestLlmContext } from "../src/llm/pr-context.js";
import type {
  PullRequestData,
  PullRequestFileData,
} from "../src/domain/pull-request-data.js";

type GitHubPullRequest = {
  number: number;
  title: string;
  body: string | null;
  user: { login: string } | null;
  base: { ref: string };
  head: { ref: string; sha: string };
  html_url: string;
  additions: number;
  deletions: number;
  changed_files: number;
  labels: { name: string }[];
};

type GitHubPullRequestFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
};

function headers(): Record<string, string> {
  const result: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) {
    result.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return result;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: headers() });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${url}`);
  }
  return response.json() as Promise<T>;
}

async function fetchAllFiles(
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<GitHubPullRequestFile[]> {
  const files: GitHubPullRequestFile[] = [];

  for (let page = 1; ; page += 1) {
    const batch = await fetchJson<GitHubPullRequestFile[]>(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100&page=${page}`,
    );
    files.push(...batch);
    if (batch.length < 100) return files;
  }
}

async function fetchPullRequestData(url: string): Promise<PullRequestData> {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) throw new Error(`URL de PR invalide: ${url}`);

  const [, owner, repo, pullNumberText] = match as [
    string,
    string,
    string,
    string,
  ];
  const pullNumber = Number.parseInt(pullNumberText, 10);

  const [pullRequest, rawFiles] = await Promise.all([
    fetchJson<GitHubPullRequest>(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`,
    ),
    fetchAllFiles(owner, repo, pullNumber),
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
    number: pullRequest.number,
    title: pullRequest.title,
    body: pullRequest.body ?? "",
    author: pullRequest.user?.login ?? "unknown",
    baseBranch: pullRequest.base.ref,
    headBranch: pullRequest.head.ref,
    headSha: pullRequest.head.sha,
    htmlUrl: pullRequest.html_url,
    additions: pullRequest.additions,
    deletions: pullRequest.deletions,
    changedFilesCount: pullRequest.changed_files,
    files,
    repositoryLabels: [],
    pullRequestLabels: pullRequest.labels.map((label) => label.name),
  };
}

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error(
    "Usage: npx tsx scripts/evaluate-file-selection.ts <PR_URL> [PR_URL...]",
  );
  process.exit(1);
}

for (const url of urls) {
  const data = await fetchPullRequestData(url);
  const context = buildPullRequestLlmContext(data);

  console.log(`\n${data.htmlUrl}`);
  console.log(`${data.title}`);
  console.log(`Labels: ${data.pullRequestLabels.join(", ") || "(aucun)"}`);
  console.log(
    `Fichiers: ${data.changedFilesCount}; sélectionnés: ${context.selectedFilesCount}; résumés seulement: ${context.summaryOnlyFilesCount}`,
  );

  for (const selected of context.selectedFiles) {
    console.log(
      `  ${selected.score.toString().padStart(3)}  ${selected.file.filename} — ${selected.reasons.join(", ")}`,
    );
  }
}

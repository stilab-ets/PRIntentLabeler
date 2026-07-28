/**
 * Teste le pipeline complet (scoring → contexte → Groq) sur une vraie PR publique.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/test-with-real-pr.ts <PR_URL> [--token GH_TOKEN]
 *
 * Exemples:
 *   npx tsx --env-file=.env scripts/test-with-real-pr.ts https://github.com/facebook/react/pull/31823
 *   npx tsx --env-file=.env scripts/test-with-real-pr.ts https://github.com/microsoft/vscode/pull/234000 --token ghp_xxx
 */

import { GroqProvider } from "../src/llm/groq-provider.js";
import { buildPullRequestLlmContext } from "../src/llm/pr-context.js";
import { filterValidSuggestions } from "../src/labels/label-policy.js";
import type {
  PullRequestData,
  PullRequestFileData,
} from "../src/domain/pull-request-data.js";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const prUrl = args[0];
const tokenIndex = args.indexOf("--token");
const githubToken =
  tokenIndex !== -1 ? args[tokenIndex + 1] : process.env.GITHUB_TOKEN;

if (!prUrl || !prUrl.startsWith("https://github.com/")) {
  console.error(
    "Usage: npx tsx --env-file=.env scripts/test-with-real-pr.ts <PR_URL> [--token GH_TOKEN]",
  );
  process.exit(1);
}

const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
if (!match) {
  console.error(`URL invalide : ${prUrl}`);
  process.exit(1);
}

const [, owner, repo, pullNumberStr] = match as [
  string,
  string,
  string,
  string,
];
const pullNumber = parseInt(pullNumberStr, 10);

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

function ghHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (githubToken) headers["Authorization"] = `Bearer ${githubToken}`;
  return headers;
}

async function ghFetch<T>(path: string): Promise<T> {
  const url = `https://api.github.com${path}`;
  const res = await fetch(url, { headers: ghHeaders() });

  if (res.status === 403) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      const reset = res.headers.get("x-ratelimit-reset");
      const resetDate = reset
        ? new Date(parseInt(reset) * 1000).toLocaleTimeString()
        : "?";
      throw new Error(
        `Rate limit GitHub atteint. Réessayez après ${resetDate} ou passez --token <GH_TOKEN>.`,
      );
    }
  }

  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} sur ${url}`);
  }

  return res.json() as Promise<T>;
}

async function fetchPrData(
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PullRequestData> {
  console.log(`\nRécupération de la PR #${pullNumber} sur ${owner}/${repo}...`);

  const [pr, filesRaw, labelsRaw, prLabelsRaw] = await Promise.all([
    ghFetch<{
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
    }>(`/repos/${owner}/${repo}/pulls/${pullNumber}`),

    ghFetch<
      {
        filename: string;
        status: string;
        additions: number;
        deletions: number;
        changes: number;
        patch?: string;
      }[]
    >(`/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100`),

    ghFetch<{ name: string }[]>(`/repos/${owner}/${repo}/labels?per_page=100`),
    ghFetch<{ name: string }[]>(
      `/repos/${owner}/${repo}/issues/${pullNumber}/labels?per_page=100`,
    ),
  ]);

  const files: PullRequestFileData[] = filesRaw.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    changes: f.changes,
    patch: f.patch,
  }));

  return {
    owner,
    repo,
    number: pr.number,
    title: pr.title,
    body: pr.body ?? "",
    author: pr.user?.login ?? "unknown",
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
    headSha: pr.head.sha,
    htmlUrl: pr.html_url,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFilesCount: pr.changed_files,
    files,
    repositoryLabels: labelsRaw.map((l) => l.name),
    pullRequestLabels: prLabelsRaw.map((l) => l.name),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const groqApiKey = process.env.GROQ_API_KEY;
if (!groqApiKey) {
  console.error("GROQ_API_KEY manquante dans .env");
  process.exit(1);
}

const prData = await fetchPrData(owner, repo, pullNumber);

console.log(`\n📋 PR : ${prData.title}`);
console.log(`   Auteur  : ${prData.author}`);
console.log(`   Branche : ${prData.headBranch} → ${prData.baseBranch}`);
console.log(
  `   Fichiers: ${prData.changedFilesCount} modifiés (+${prData.additions}/-${prData.deletions})`,
);
console.log(
  `   Labels repo : ${prData.repositoryLabels.join(", ") || "(aucun)"}\n`,
);

const llmContext = buildPullRequestLlmContext(prData);

console.log(`🔍 Contexte filtré :`);
console.log(`   Fichiers sélectionnés  : ${llmContext.selectedFilesCount}`);
console.log(
  `   Fichiers résumés seulement : ${llmContext.summaryOnlyFilesCount}`,
);
console.log(`   Résumé (${llmContext.allFilesSummary.length} fichiers) :\n`);

for (const f of llmContext.allFilesSummary.slice(0, 10)) {
  const tag =
    f.contentPolicy === "summary-only"
      ? " [résumé seulement]"
      : ` [score ${f.score} pts]`;
  console.log(
    `   ${f.contentPolicy === "summary-only" ? "✗" : "✓"} ${f.filename}${tag}`,
  );
}
if (llmContext.allFilesSummary.length > 10) {
  console.log(
    `   ... et ${llmContext.allFilesSummary.length - 10} autre(s) fichier(s)`,
  );
}

console.log(
  `\n🤖 Appel Groq en cours (${process.env.GROQ_MODEL ?? "llama-3.1-8b-instant"})...`,
);

const provider = new GroqProvider(groqApiKey, process.env.GROQ_MODEL);
const raw = await provider.classifyPullRequest(llmContext);
const filtered = filterValidSuggestions(
  raw.suggestions,
  prData.repositoryLabels,
);

console.log(`\n🏷️  Suggestions :`);
if (filtered.length === 0) {
  console.log(
    "   (aucune suggestion avec confiance ≥ 70% parmi les labels du repo)",
  );
  if (raw.suggestions.length > 0) {
    console.log("\n   Suggestions brutes (non filtrées) :");
    for (const s of raw.suggestions) {
      console.log(
        `   - ${s.name} (${Math.round(s.confidence * 100)}%) : ${s.reason}`,
      );
    }
  }
} else {
  for (const s of filtered) {
    console.log(
      `   - ${s.name} (${Math.round(s.confidence * 100)}%) : ${s.reason}`,
    );
  }
}

console.log(`\n📝 Résumé : ${raw.summary}`);

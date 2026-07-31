import { describe, expect, it } from "vitest";
import { createLlmProvider } from "../src/llm/provider-factory.js";
import { buildPullRequestLlmContext } from "../src/llm/pr-context.js";
import type { PullRequestData } from "../src/domain/pull-request-data.js";

function prWithFiles(count: number, patchSize: number): PullRequestData {
  return {
    owner: "org",
    repo: "repo",
    number: 1,
    title: "feat: many changes",
    body: "",
    author: "dev",
    baseBranch: "main",
    headBranch: "feat",
    headSha: "sha",
    htmlUrl: "",
    additions: count * 10,
    deletions: 0,
    changedFilesCount: count,
    files: Array.from({ length: count }, (_, i) => ({
      filename: `src/module${i}.ts`,
      status: "modified",
      additions: 10,
      deletions: 0,
      changes: 10,
      patch: `@@\n+${"x".repeat(patchSize)}\n`,
    })),
    repositoryLabels: ["enhancement"],
    pullRequestLabels: [],
  };
}

describe("sélection de fichiers selon le budget du provider", () => {
  it("attache à chaque provider la fenêtre de son modèle", () => {
    const gemini = createLlmProvider({
      provider: "gemini",
      apiKey: "test-key",
      model: "gemini-3.5-flash",
    });
    const groq = createLlmProvider({
      provider: "groq",
      apiKey: "test-key",
      model: "llama-3.1-8b-instant",
    });

    expect(gemini.tokenBudget?.contextWindowTokens).toBe(1_000_000);
    expect(groq.tokenBudget?.contextWindowTokens).toBe(131_072);
  });

  it("un budget modèle plus large autorise plus de fichiers représentatifs", () => {
    const prData = prWithFiles(12, 1_200);
    const large = buildPullRequestLlmContext(prData, {
      tokenBudget: {
        contextWindowTokens: 200_000,
        responseReserveTokens: 3_000,
        promptTokenBudget: 150_000,
        source: "model",
      },
    });
    const small = buildPullRequestLlmContext(prData, {
      tokenBudget: {
        contextWindowTokens: 8_000,
        responseReserveTokens: 2_000,
        promptTokenBudget: 3_500,
        source: "environment",
      },
    });

    expect(large.selectedFilesCount).toBeGreaterThan(small.selectedFilesCount);
    expect(small.selectedFilesCount).toBeGreaterThan(0);
    expect(large.promptBudget.contextLimitTokens).toBe(200_000);
    expect(small.promptBudget.contextLimitTokens).toBe(8_000);
  });
});

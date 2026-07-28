import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPullRequestLlmContext } from "../src/llm/pr-context.js";
import { GroqProvider } from "../src/llm/groq-provider.js";
import type { PullRequestData } from "../src/domain/pull-request-data.js";

const { createCompletion } = vi.hoisted(() => ({
  createCompletion: vi.fn(),
}));

vi.mock("groq-sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: createCompletion } },
  })),
}));

const prData: PullRequestData = {
  owner: "org",
  repo: "repo",
  number: 1,
  title: "fix login",
  body: "",
  author: "author",
  baseBranch: "main",
  headBranch: "fix",
  headSha: "sha",
  htmlUrl: "",
  additions: 1,
  deletions: 0,
  changedFilesCount: 1,
  files: [
    {
      filename: "src/login.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
      changes: 1,
      patch: "+fix",
    },
  ],
  repositoryLabels: ["bug"],
  pullRequestLabels: [],
};

describe("GroqProvider", () => {
  beforeEach(() => {
    createCompletion.mockReset();
  });

  it("retourne les suggestions et publie les métriques réelles d'usage", async () => {
    createCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              suggestions: [
                { name: "bug", confidence: 1.2, reason: "crash corrigé" },
              ],
              summary: "Corrige le login.",
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 321,
        completion_tokens: 45,
        total_tokens: 366,
      },
    });
    const onUsage = vi.fn();
    const provider = new GroqProvider("key", "test-model", onUsage);

    const result = await provider.classifyPullRequest(
      buildPullRequestLlmContext(prData),
    );

    expect(result.suggestions[0].confidence).toBe(1);
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-model",
        promptTokens: 321,
        completionTokens: 45,
        totalTokens: 366,
        estimatedPromptTokens: expect.any(Number),
        absolutePromptTokenError: expect.any(Number),
        promptTokenErrorPercentage: expect.any(Number),
      }),
    );
  });

  it("n'invente aucune métrique lorsque Groq ne retourne pas usage", async () => {
    createCompletion.mockResolvedValue({
      choices: [{ message: { content: '{"suggestions":[],"summary":""}' } }],
    });
    const onUsage = vi.fn();
    const provider = new GroqProvider("key", "test-model", onUsage);

    await provider.classifyPullRequest(buildPullRequestLlmContext(prData));

    expect(onUsage).not.toHaveBeenCalled();
  });
});

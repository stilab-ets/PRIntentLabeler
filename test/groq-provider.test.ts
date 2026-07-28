import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPullRequestLlmContext } from "../src/llm/pr-context.js";
import { GroqProvider } from "../src/llm/groq-provider.js";
import type { PullRequestData } from "../src/domain/pull-request-data.js";

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

function mockFetchResponse(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })),
  );
}

describe("GroqProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retourne les suggestions et publie les métriques réelles d'usage", async () => {
    mockFetchResponse({
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
    const provider = new GroqProvider("key", "test-model", undefined, onUsage);

    const result = await provider.classifyPullRequest(
      buildPullRequestLlmContext(prData),
    );

    expect(result.suggestions[0].confidence).toBe(1);
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "Groq",
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
    mockFetchResponse({
      choices: [{ message: { content: '{"suggestions":[],"summary":""}' } }],
    });
    const onUsage = vi.fn();
    const provider = new GroqProvider("key", "test-model", undefined, onUsage);

    await provider.classifyPullRequest(buildPullRequestLlmContext(prData));

    expect(onUsage).not.toHaveBeenCalled();
  });

  it("appelle l’endpoint Groq par défaut avec le bon Bearer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "OK" } }] }),
        {
          status: 200,
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new GroqProvider("secret-groq", "test-model").checkConnection();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.groq.com/openai/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer secret-groq",
        }),
      }),
    );
  });
});

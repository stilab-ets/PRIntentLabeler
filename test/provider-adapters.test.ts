import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "../src/llm/anthropic-provider.js";
import { GeminiProvider } from "../src/llm/gemini-provider.js";
import { OpenAiCompatibleProvider } from "../src/llm/openai-compatible-provider.js";
import { PerplexityProvider } from "../src/llm/perplexity-provider.js";
import { buildPullRequestLlmContext } from "../src/llm/pr-context.js";
import type { PullRequestData } from "../src/domain/pull-request-data.js";
import { LLM_RESPONSE_TOKEN_RESERVE } from "../src/utils/constants.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

describe("adaptateurs LLM", () => {
  it("authentifie une API compatible OpenAI avec Bearer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "OK" } }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiCompatibleProvider({
      providerName: "OpenAI",
      apiKey: "secret-openai",
      model: "test-model",
      baseUrl: "https://api.example.com/v1",
    });
    await provider.checkConnection();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer secret-openai",
        }),
      }),
    );
  });

  it("utilise les en-têtes requis par Anthropic", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ content: [{ type: "text", text: "OK" }] }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await new AnthropicProvider("secret", "claude-test").checkConnection();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "secret",
          "anthropic-version": "2023-06-01",
        }),
      }),
    );
  });

  it("utilise l’en-tête et l’endpoint generateContent de Gemini", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "OK" }] } }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new GeminiProvider("gemini-key", "gemini-test").checkConnection();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-goog-api-key": "gemini-key",
        }),
      }),
    );
  });

  it("appelle l’endpoint Sonar sélectionné pour Perplexity", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "OK" } }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new PerplexityProvider("pplx-key", "sonar").checkConnection();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.perplexity.ai/v1/sonar",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer pplx-key",
        }),
      }),
    );
  });

  it("signale une réponse Gemini vide causée par le plafond de jetons", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [] }, finishReason: "MAX_TOKENS" },
            ],
            usageMetadata: { promptTokenCount: 1200, thoughtsTokenCount: 3000 },
          }),
          { status: 200 },
        ),
      ),
    );

    const provider = new GeminiProvider("gemini-key", "gemini-2.5-flash");

    await expect(
      provider.classifyPullRequest(buildPullRequestLlmContext(prData)),
    ).rejects.toThrow("Gemini a renvoyé une réponse vide");
  });

  it("accorde à Gemini la marge de sortie prévue pour la réflexion", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: '{"suggestions":[],"summary":"rien"}' }],
              },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new GeminiProvider(
      "gemini-key",
      "gemini-2.5-flash",
    ).classifyPullRequest(buildPullRequestLlmContext(prData));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      generationConfig: { maxOutputTokens: number };
    };
    expect(body.generationConfig.maxOutputTokens).toBe(
      LLM_RESPONSE_TOKEN_RESERVE,
    );
  });

  it("signale une réponse vide d’une API compatible OpenAI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "" } }] }),
          {
            status: 200,
          },
        ),
      ),
    );

    const provider = new OpenAiCompatibleProvider({
      providerName: "OpenAI",
      apiKey: "secret",
      model: "test-model",
      baseUrl: "https://api.example.com/v1",
    });

    await expect(
      provider.classifyPullRequest(buildPullRequestLlmContext(prData)),
    ).rejects.toThrow("OpenAI a renvoyé une réponse vide");
  });

  it("retourne une erreur sûre sans inclure la clé", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { message: "Invalid credentials" } }),
            { status: 401 },
          ),
        ),
    );

    const provider = new OpenAiCompatibleProvider({
      providerName: "OpenAI",
      apiKey: "never-log-this-key",
      model: "test-model",
      baseUrl: "https://api.example.com/v1",
    });

    await expect(provider.checkConnection()).rejects.toThrow(
      "OpenAI a rejeté la requête (401)",
    );
    await expect(provider.checkConnection()).rejects.not.toThrow(
      "never-log-this-key",
    );
  });
});

import type { PullRequestLlmContext } from "../domain/pull-request-data.js";
import type { PullRequestAnalysis } from "../domain/llm-analysis.js";
import { parsePullRequestAnalysis } from "./classification-parser.js";
import type { LlmProvider } from "./llm-provider.js";
import { LlmProviderRequestError } from "./provider-error.js";
import {
  buildClassificationPrompt,
  buildClassificationSystemPrompt,
} from "./prompt-builder.js";

type PerplexityResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
};

export class PerplexityProvider implements LlmProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl = "https://api.perplexity.ai/v1",
  ) {}

  async classifyPullRequest(
    context: PullRequestLlmContext,
  ): Promise<PullRequestAnalysis> {
    const content = await this.createCompletion(
      buildClassificationSystemPrompt(),
      buildClassificationPrompt(context),
      512,
    );
    return parsePullRequestAnalysis(content);
  }

  async checkConnection(): Promise<void> {
    await this.createCompletion(
      "Reply with the single word OK.",
      "Connection test.",
      8,
    );
  }

  private async createCompletion(
    system: string,
    prompt: string,
    maxTokens: number,
  ): Promise<string> {
    const response = await fetch(
      `${this.baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(this.model)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    const payload = (await response
      .json()
      .catch(() => ({}))) as PerplexityResponse;

    if (!response.ok) {
      throw new LlmProviderRequestError(
        "Perplexity",
        response.status,
        payload.error?.message,
      );
    }

    return payload.choices?.[0]?.message?.content ?? "";
  }
}

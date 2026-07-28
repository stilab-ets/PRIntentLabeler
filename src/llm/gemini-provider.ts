import type { PullRequestLlmContext } from "../domain/pull-request-data.js";
import type { PullRequestAnalysis } from "../domain/llm-analysis.js";
import { parsePullRequestAnalysis } from "./classification-parser.js";
import type { LlmProvider } from "./llm-provider.js";
import { LlmProviderRequestError } from "./provider-error.js";
import {
  buildClassificationPrompt,
  buildClassificationSystemPrompt,
} from "./prompt-builder.js";

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

const ANALYSIS_SCHEMA = {
  type: "OBJECT",
  properties: {
    suggestions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          confidence: { type: "NUMBER" },
          reason: { type: "STRING" },
        },
        required: ["name", "confidence", "reason"],
      },
    },
    summary: { type: "STRING" },
  },
  required: ["suggestions", "summary"],
};

export class GeminiProvider implements LlmProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl = "https://generativelanguage.googleapis.com/v1beta",
  ) {}

  async classifyPullRequest(
    context: PullRequestLlmContext,
  ): Promise<PullRequestAnalysis> {
    const content = await this.generateContent(
      buildClassificationSystemPrompt(),
      buildClassificationPrompt(context),
      true,
      512,
    );
    return parsePullRequestAnalysis(content);
  }

  async checkConnection(): Promise<void> {
    await this.generateContent(
      "Reply with the single word OK.",
      "Connection test.",
      false,
      8,
    );
  }

  private async generateContent(
    system: string,
    prompt: string,
    structured: boolean,
    maxOutputTokens: number,
  ): Promise<string> {
    const model = this.model.replace(/^models\//, "");
    const generationConfig: Record<string, unknown> = {
      maxOutputTokens,
    };

    if (structured) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = ANALYSIS_SCHEMA;
    }

    const response = await fetch(
      `${this.baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: system }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    const payload = (await response.json().catch(() => ({}))) as GeminiResponse;

    if (!response.ok) {
      throw new LlmProviderRequestError(
        "Gemini",
        response.status,
        payload.error?.message,
      );
    }

    return (
      payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("") ?? ""
    );
  }
}

import type { PullRequestLlmContext } from "../domain/pull-request-data.js";
import type { PullRequestAnalysis } from "../domain/llm-analysis.js";
import { parsePullRequestAnalysis } from "./classification-parser.js";
import type { LlmProvider } from "./llm-provider.js";
import {
  LlmEmptyResponseError,
  LlmProviderRequestError,
  parseRetryAfterMs,
} from "./provider-error.js";
import { retryLlmRequest } from "./retry.js";
import {
  buildClassificationPrompt,
  buildClassificationSystemPrompt,
} from "./prompt-builder.js";
import { resolveLlmTokenBudget, type LlmTokenBudget } from "./model-budget.js";
import { estimateTokens } from "./patch-utils.js";
import type { LlmUsageMetrics } from "./openai-compatible-provider.js";

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  };
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
  public readonly tokenBudget: LlmTokenBudget;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl = "https://generativelanguage.googleapis.com/v1beta",
    private readonly onUsage?: (metrics: LlmUsageMetrics) => void,
    tokenBudget?: LlmTokenBudget,
  ) {
    this.tokenBudget = tokenBudget ?? resolveLlmTokenBudget("gemini", model);
  }

  async classifyPullRequest(
    context: PullRequestLlmContext,
  ): Promise<PullRequestAnalysis> {
    const system = buildClassificationSystemPrompt();
    const prompt = buildClassificationPrompt(context);
    const content = await retryLlmRequest(() =>
      this.generateContent(
        system,
        prompt,
        true,
        this.tokenBudget.responseReserveTokens,
        estimateTokens(system) + estimateTokens(prompt),
      ),
    );

    if (!content.trim()) {
      throw new LlmEmptyResponseError("Gemini");
    }

    return parsePullRequestAnalysis(content);
  }

  // Le test de connexion valide seulement les identifiants : une réponse vide
  // reste acceptable ici, contrairement à une classification.
  async checkConnection(): Promise<void> {
    await this.generateContent(
      "Reply with the single word OK.",
      "Connection test.",
      false,
      this.tokenBudget.responseReserveTokens,
    );
  }

  private async generateContent(
    system: string,
    prompt: string,
    structured: boolean,
    maxOutputTokens: number,
    estimatedPromptTokens = 0,
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
        parseRetryAfterMs(response.headers.get("retry-after")),
      );
    }

    this.reportUsage(payload.usageMetadata, estimatedPromptTokens);

    const candidate = payload.candidates?.[0];
    const text =
      candidate?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";

    // Depuis Gemini 2.5, `maxOutputTokens` plafonne réflexion + réponse : si la
    // réflexion consomme tout, l'API renvoie MAX_TOKENS sans aucun texte.
    if (!text.trim() && candidate?.finishReason === "MAX_TOKENS") {
      throw new LlmEmptyResponseError(
        "Gemini",
        `plafond de ${maxOutputTokens} jetons de sortie épuisé par la réflexion du modèle`,
      );
    }

    return text;
  }

  private reportUsage(
    usage: GeminiResponse["usageMetadata"],
    estimatedPromptTokens: number,
  ): void {
    if (!this.onUsage || !usage) return;

    const promptTokens = usage.promptTokenCount ?? 0;
    const completionTokens =
      (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
    const absolutePromptTokenError = Math.abs(
      promptTokens - estimatedPromptTokens,
    );

    this.onUsage({
      provider: "Gemini",
      model: this.model,
      promptTokens,
      completionTokens,
      totalTokens: usage.totalTokenCount ?? promptTokens + completionTokens,
      estimatedPromptTokens,
      absolutePromptTokenError,
      promptTokenErrorPercentage:
        promptTokens === 0
          ? 0
          : (absolutePromptTokenError / promptTokens) * 100,
    });
  }
}

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
import { estimateTokens } from "./patch-utils.js";
import {
  buildClassificationPrompt,
  buildClassificationSystemPrompt,
} from "./prompt-builder.js";
import { LLM_RESPONSE_TOKEN_RESERVE } from "../utils/constants.js";

// Métriques comparant les jetons réellement facturés par le fournisseur à
// notre estimation locale, pour surveiller la fiabilité du budget de prompt.
export type LlmUsageMetrics = {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedPromptTokens: number;
  absolutePromptTokenError: number;
  promptTokenErrorPercentage: number;
};

type OpenAiCompatibleOptions = {
  providerName: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  supportsJsonMode?: boolean;
  usesMaxCompletionTokens?: boolean;
  onUsage?: (metrics: LlmUsageMetrics) => void;
};

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
  };
};

export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(private readonly options: OpenAiCompatibleOptions) {}

  async classifyPullRequest(
    context: PullRequestLlmContext,
  ): Promise<PullRequestAnalysis> {
    return this.classifyWithPrompt(buildClassificationPrompt(context));
  }

  // Permet de rejouer un prompt déjà construit (ex. scripts d'évaluation par
  // ablation) sans reconstruire le contexte complet de la PR.
  async classifyPullRequestWithPrompt(
    prompt: string,
  ): Promise<PullRequestAnalysis> {
    return this.classifyWithPrompt(prompt);
  }

  private async classifyWithPrompt(
    prompt: string,
  ): Promise<PullRequestAnalysis> {
    const content = await retryLlmRequest(() =>
      this.createCompletion(
        [
          { role: "system", content: buildClassificationSystemPrompt() },
          { role: "user", content: prompt },
        ],
        true,
      ),
    );

    if (!content.trim()) {
      throw new LlmEmptyResponseError(this.options.providerName);
    }

    return parsePullRequestAnalysis(content);
  }

  // Le test de connexion valide seulement les identifiants : une réponse vide
  // reste acceptable ici, contrairement à une classification.
  async checkConnection(): Promise<void> {
    await this.createCompletion(
      [
        {
          role: "system",
          content: "Reply with the single word OK.",
        },
        { role: "user", content: "Connection test." },
      ],
      false,
      LLM_RESPONSE_TOKEN_RESERVE,
    );
  }

  private async createCompletion(
    messages: ChatMessage[],
    structured: boolean,
    maxTokens = LLM_RESPONSE_TOKEN_RESERVE,
  ): Promise<string> {
    const tokenLimit = this.options.usesMaxCompletionTokens
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens };

    const body: Record<string, unknown> = {
      model: this.options.model,
      messages,
      ...tokenLimit,
    };

    if (structured && this.options.supportsJsonMode) {
      body.response_format = { type: "json_object" };
    }

    const estimatedPromptTokens = messages.reduce(
      (total, message) => total + estimateTokens(message.content),
      0,
    );

    const response = await fetch(
      `${this.options.baseUrl.replace(/\/+$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      },
    );

    const payload = (await response
      .json()
      .catch(() => ({}))) as ChatCompletionResponse;

    if (!response.ok) {
      throw new LlmProviderRequestError(
        this.options.providerName,
        response.status,
        payload.error?.message,
        parseRetryAfterMs(response.headers.get("retry-after")),
      );
    }

    this.reportUsage(payload.usage, estimatedPromptTokens);

    return payload.choices?.[0]?.message?.content ?? "";
  }

  private reportUsage(
    usage: ChatCompletionResponse["usage"],
    estimatedPromptTokens: number,
  ): void {
    if (
      !this.options.onUsage ||
      !usage ||
      typeof usage.prompt_tokens !== "number" ||
      typeof usage.completion_tokens !== "number" ||
      typeof usage.total_tokens !== "number"
    ) {
      return;
    }

    const absolutePromptTokenError = Math.abs(
      usage.prompt_tokens - estimatedPromptTokens,
    );

    this.options.onUsage({
      provider: this.options.providerName,
      model: this.options.model,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      estimatedPromptTokens,
      absolutePromptTokenError,
      promptTokenErrorPercentage:
        usage.prompt_tokens === 0
          ? 0
          : (absolutePromptTokenError / usage.prompt_tokens) * 100,
    });
  }
}

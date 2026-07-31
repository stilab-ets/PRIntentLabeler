import {
  OpenAiCompatibleProvider,
  type LlmUsageMetrics,
} from "./openai-compatible-provider.js";
import { resolveLlmTokenBudget, type LlmTokenBudget } from "./model-budget.js";

export type { LlmUsageMetrics as GroqUsageMetrics } from "./openai-compatible-provider.js";

export class GroqProvider extends OpenAiCompatibleProvider {
  constructor(
    apiKey: string,
    model = "llama-3.1-8b-instant",
    baseUrl = "https://api.groq.com/openai/v1",
    onUsage?: (metrics: LlmUsageMetrics) => void,
    tokenBudget?: LlmTokenBudget,
  ) {
    super({
      providerName: "Groq",
      apiKey,
      model,
      baseUrl,
      supportsJsonMode: true,
      onUsage,
      tokenBudget: tokenBudget ?? resolveLlmTokenBudget("groq", model),
    });
  }
}

import { AnthropicProvider } from "./anthropic-provider.js";
import { GeminiProvider } from "./gemini-provider.js";
import { GroqProvider } from "./groq-provider.js";
import type { LlmProvider } from "./llm-provider.js";
import {
  OpenAiCompatibleProvider,
  type LlmUsageMetrics,
} from "./openai-compatible-provider.js";
import { PerplexityProvider } from "./perplexity-provider.js";
import {
  normalizeProviderBaseUrl,
  type LlmProviderConfiguration,
} from "./provider-configuration.js";

export function createLlmProvider(
  configuration: LlmProviderConfiguration,
  onUsage?: (metrics: LlmUsageMetrics) => void,
): LlmProvider {
  const apiKey = configuration.apiKey.trim();
  const model = configuration.model.trim();

  if (!apiKey) throw new Error("La clé API du fournisseur est requise.");
  if (!model) throw new Error("Le modèle LLM est requis.");

  const baseUrl = normalizeProviderBaseUrl(
    configuration.provider,
    configuration.provider === "custom" ? configuration.baseUrl : undefined,
  );

  switch (configuration.provider) {
    case "groq":
      return new GroqProvider(apiKey, model, baseUrl, onUsage);
    case "openai":
      return new OpenAiCompatibleProvider({
        providerName: "OpenAI",
        apiKey,
        model,
        baseUrl,
        supportsJsonMode: true,
        usesMaxCompletionTokens: true,
        onUsage,
      });
    case "anthropic":
      return new AnthropicProvider(apiKey, model, baseUrl);
    case "gemini":
      return new GeminiProvider(apiKey, model, baseUrl);
    case "xai":
      return new OpenAiCompatibleProvider({
        providerName: "xAI",
        apiKey,
        model,
        baseUrl,
        supportsJsonMode: true,
        onUsage,
      });
    case "perplexity":
      return new PerplexityProvider(apiKey, model, baseUrl);
    case "custom":
      return new OpenAiCompatibleProvider({
        providerName: "API compatible OpenAI",
        apiKey,
        model,
        baseUrl,
        onUsage,
      });
  }
}

export function createEnvironmentLlmProvider(
  onUsage?: (metrics: LlmUsageMetrics) => void,
): LlmProvider | null {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === "REMPLACER_PAR_VOTRE_CLE") return null;

  return createLlmProvider(
    {
      provider: "groq",
      apiKey,
      model: process.env.GROQ_MODEL ?? "llama-3.1-8b-instant",
    },
    onUsage,
  );
}

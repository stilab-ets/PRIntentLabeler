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
import { resolveLlmTokenBudget } from "./model-budget.js";

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

  // Résolu une seule fois ici : c'est ce budget qui décide ensuite du nombre de
  // fichiers et de la taille des diffs envoyés au modèle choisi.
  const tokenBudget = resolveLlmTokenBudget(configuration.provider, model);

  switch (configuration.provider) {
    case "groq":
      return new GroqProvider(apiKey, model, baseUrl, onUsage, tokenBudget);
    case "openai":
      return new OpenAiCompatibleProvider({
        providerName: "OpenAI",
        apiKey,
        model,
        baseUrl,
        supportsJsonMode: true,
        usesMaxCompletionTokens: true,
        onUsage,
        tokenBudget,
      });
    case "anthropic":
      return new AnthropicProvider(apiKey, model, baseUrl, tokenBudget);
    case "gemini":
      return new GeminiProvider(apiKey, model, baseUrl, onUsage, tokenBudget);
    case "xai":
      return new OpenAiCompatibleProvider({
        providerName: "xAI",
        apiKey,
        model,
        baseUrl,
        supportsJsonMode: true,
        onUsage,
        tokenBudget,
      });
    case "perplexity":
      return new PerplexityProvider(apiKey, model, baseUrl, tokenBudget);
    case "custom":
      return new OpenAiCompatibleProvider({
        providerName: "API compatible OpenAI",
        apiKey,
        model,
        baseUrl,
        onUsage,
        tokenBudget,
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

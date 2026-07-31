import {
  LLM_PROMPT_SAFETY_RATIO,
  LLM_RESPONSE_TOKEN_RESERVE,
  LLM_RESPONSE_RESERVE_MAX_RATIO,
} from "../utils/constants.js";
import type { LlmProviderName } from "./provider-configuration.js";

export type LlmTokenBudget = {
  // Fenêtre totale du modèle : prompt + réponse.
  contextWindowTokens: number;
  // Part réservée à la réponse, réflexion des modèles à raisonnement incluse.
  responseReserveTokens: number;
  // Ce que le prompt peut réellement occuper, marge de sécurité déduite.
  promptTokenBudget: number;
  // D'où vient la fenêtre retenue, pour pouvoir auditer un budget surprenant.
  source: "environment" | "model" | "provider-default" | "fallback";
};

// Fenêtre par défaut quand ni le modèle ni le fournisseur ne sont connus :
// volontairement basse, un budget sous-estimé tronque du contexte alors qu'un
// budget surestimé fait rejeter la requête entière par le fournisseur.
const FALLBACK_CONTEXT_WINDOW_TOKENS = 16_384;

const PROVIDER_DEFAULT_WINDOWS: Record<LlmProviderName, number> = {
  groq: 32_768,
  openai: 128_000,
  anthropic: 200_000,
  gemini: 1_000_000,
  xai: 131_072,
  perplexity: 120_000,
  // Backend inconnu (auto-hébergé, proxy) : on reste prudent.
  custom: FALLBACK_CONTEXT_WINDOW_TOKENS,
};

// Reconnaissance par préfixe : les familles de modèles évoluent vite et leurs
// noms portent des suffixes de date ou de version qu'on ne veut pas énumérer.
const MODEL_WINDOW_PREFIXES: Partial<
  Record<LlmProviderName, Array<{ prefix: string; window: number }>>
> = {
  groq: [
    { prefix: "llama-3.1", window: 131_072 },
    { prefix: "llama-3.3", window: 131_072 },
    { prefix: "llama-4", window: 131_072 },
    { prefix: "mixtral", window: 32_768 },
    { prefix: "gemma", window: 8_192 },
  ],
  openai: [
    { prefix: "gpt-4o", window: 128_000 },
    { prefix: "gpt-4.1", window: 1_000_000 },
    { prefix: "gpt-5", window: 400_000 },
    { prefix: "o1", window: 200_000 },
    { prefix: "o3", window: 200_000 },
  ],
  anthropic: [{ prefix: "claude", window: 200_000 }],
  gemini: [
    { prefix: "gemini-1.5-flash", window: 1_000_000 },
    { prefix: "gemini-1.5-pro", window: 2_000_000 },
    { prefix: "gemini-2", window: 1_000_000 },
    { prefix: "gemini-3", window: 1_000_000 },
  ],
  xai: [{ prefix: "grok", window: 131_072 }],
  perplexity: [{ prefix: "sonar", window: 120_000 }],
};

function resolveContextWindow(
  provider: LlmProviderName,
  model: string,
): { window: number; source: LlmTokenBudget["source"] } {
  // Échappatoire explicite pour un backend maison ou un quota négocié.
  const configured = Number.parseInt(
    process.env.LLM_CONTEXT_WINDOW_TOKENS ?? "",
    10,
  );
  if (Number.isFinite(configured) && configured > 0) {
    return { window: configured, source: "environment" };
  }

  const normalizedModel = model
    .trim()
    .toLowerCase()
    .replace(/^models\//, "");
  const prefixes = MODEL_WINDOW_PREFIXES[provider] ?? [];
  // Le préfixe le plus long gagne, sinon "gemini-2" masquerait un réglage plus
  // précis comme "gemini-2.5-flash-lite".
  const match = [...prefixes]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((entry) => normalizedModel.startsWith(entry.prefix));
  if (match) return { window: match.window, source: "model" };

  const providerDefault = PROVIDER_DEFAULT_WINDOWS[provider];
  if (providerDefault) {
    return { window: providerDefault, source: "provider-default" };
  }

  return { window: FALLBACK_CONTEXT_WINDOW_TOKENS, source: "fallback" };
}

export function resolveLlmTokenBudget(
  provider: LlmProviderName,
  model: string,
): LlmTokenBudget {
  const { window, source } = resolveContextWindow(provider, model);

  // Un petit modèle ne peut pas réserver 3 000 jetons de réponse sans qu'il ne
  // reste plus rien au prompt : la réserve suit alors la taille de la fenêtre.
  const responseReserveTokens = Math.min(
    LLM_RESPONSE_TOKEN_RESERVE,
    Math.floor(window * LLM_RESPONSE_RESERVE_MAX_RATIO),
  );

  const usableTokens = Math.floor(window * LLM_PROMPT_SAFETY_RATIO);
  const promptTokenBudget = Math.max(0, usableTokens - responseReserveTokens);

  return {
    contextWindowTokens: window,
    responseReserveTokens,
    promptTokenBudget,
    source,
  };
}

// Budget utilisé quand aucun fournisseur n'est connu (provider injecté dans les
// tests, reconstruction d'un commentaire hors appel LLM).
export function defaultLlmTokenBudget(): LlmTokenBudget {
  return resolveLlmTokenBudget("custom", "");
}

export const LLM_PROVIDER_NAMES = [
  "groq",
  "openai",
  "anthropic",
  "gemini",
  "xai",
  "perplexity",
  "custom",
] as const;

export type LlmProviderName = (typeof LLM_PROVIDER_NAMES)[number];

export type LlmProviderConfiguration = {
  provider: LlmProviderName;
  apiKey: string;
  model: string;
  baseUrl?: string;
};

export type LlmProviderDefinition = {
  name: LlmProviderName;
  displayName: string;
  defaultModel: string;
  suggestedModels: string[];
  defaultBaseUrl?: string;
  requiresBaseUrl?: boolean;
};

export const LLM_PROVIDER_DEFINITIONS: Record<
  LlmProviderName,
  LlmProviderDefinition
> = {
  groq: {
    name: "groq",
    displayName: "Groq",
    defaultModel: "llama-3.1-8b-instant",
    suggestedModels: ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"],
    defaultBaseUrl: "https://api.groq.com/openai/v1",
  },
  openai: {
    name: "openai",
    displayName: "OpenAI",
    defaultModel: "gpt-5-mini",
    suggestedModels: ["gpt-5-mini", "gpt-5.4-mini", "gpt-5.6-luna"],
    defaultBaseUrl: "https://api.openai.com/v1",
  },
  anthropic: {
    name: "anthropic",
    displayName: "Anthropic (Claude)",
    defaultModel: "claude-haiku-4-5-20251001",
    suggestedModels: [
      "claude-haiku-4-5-20251001",
      "claude-sonnet-5",
      "claude-opus-4-8",
    ],
    defaultBaseUrl: "https://api.anthropic.com/v1",
  },
  gemini: {
    name: "gemini",
    displayName: "Google Gemini",
    defaultModel: "gemini-2.5-flash",
    suggestedModels: [
      "gemini-2.5-flash",
      "gemini-3.5-flash",
      "gemini-3.6-flash",
    ],
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
  xai: {
    name: "xai",
    displayName: "xAI (Grok)",
    defaultModel: "grok-4.5",
    suggestedModels: ["grok-4.5"],
    defaultBaseUrl: "https://api.x.ai/v1",
  },
  perplexity: {
    name: "perplexity",
    displayName: "Perplexity",
    defaultModel: "sonar",
    suggestedModels: ["sonar"],
    defaultBaseUrl: "https://api.perplexity.ai/v1",
  },
  custom: {
    name: "custom",
    displayName: "API compatible OpenAI",
    defaultModel: "",
    suggestedModels: [],
    requiresBaseUrl: true,
  },
};

export function isLlmProviderName(value: unknown): value is LlmProviderName {
  return (
    typeof value === "string" &&
    LLM_PROVIDER_NAMES.includes(value as LlmProviderName)
  );
}

export function getLlmProviderDefinition(
  provider: LlmProviderName,
): LlmProviderDefinition {
  return LLM_PROVIDER_DEFINITIONS[provider];
}

export function normalizeProviderBaseUrl(
  provider: LlmProviderName,
  baseUrl?: string,
): string {
  const definition = getLlmProviderDefinition(provider);
  const value = baseUrl?.trim() || definition.defaultBaseUrl;

  if (!value) {
    throw new Error("Une URL de base est requise pour ce fournisseur.");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("L’URL de base du fournisseur est invalide.");
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(
      "L’URL du fournisseur ne doit pas contenir d’identifiants, de paramètres ou d’ancre.",
    );
  }

  const localHostname =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "::1" ||
    parsed.hostname === "[::1]";
  const allowLocalDevelopment =
    process.env.NODE_ENV !== "production" && localHostname;

  if (process.env.NODE_ENV === "production" && localHostname) {
    throw new Error(
      "Une adresse locale ne peut pas être utilisée en production.",
    );
  }
  if (parsed.protocol !== "https:" && !allowLocalDevelopment) {
    throw new Error("L’URL du fournisseur doit utiliser HTTPS.");
  }

  return value.replace(/\/+$/, "");
}

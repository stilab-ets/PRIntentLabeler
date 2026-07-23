import { describe, expect, it } from "vitest";
import {
  getLlmProviderDefinition,
  isLlmProviderName,
  normalizeProviderBaseUrl,
} from "../src/llm/provider-configuration.js";

describe("provider-configuration", () => {
  it("reconnaît uniquement les fournisseurs pris en charge", () => {
    expect(isLlmProviderName("anthropic")).toBe(true);
    expect(isLlmProviderName("unknown")).toBe(false);
  });

  it("utilise l’URL officielle par défaut", () => {
    expect(normalizeProviderBaseUrl("xai")).toBe("https://api.x.ai/v1");
  });

  it("retire les barres finales d’une URL personnalisée", () => {
    expect(
      normalizeProviderBaseUrl("custom", "https://llm.example.com/v1///"),
    ).toBe("https://llm.example.com/v1");
  });

  it("refuse HTTP sauf pour un serveur local", () => {
    expect(() =>
      normalizeProviderBaseUrl("custom", "http://example.com/v1"),
    ).toThrow("HTTPS");
    expect(
      normalizeProviderBaseUrl("custom", "http://localhost:11434/v1"),
    ).toBe("http://localhost:11434/v1");
  });

  it("refuse une adresse locale en production", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() =>
        normalizeProviderBaseUrl("custom", "http://localhost:11434/v1"),
      ).toThrow("production");
    } finally {
      if (previous === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previous;
      }
    }
  });

  it("refuse les identifiants et paramètres dans l’URL", () => {
    expect(() =>
      normalizeProviderBaseUrl(
        "custom",
        "https://user:password@example.com/v1?key=value",
      ),
    ).toThrow("identifiants");
  });

  it("fournit un modèle par défaut à chaque fournisseur hébergé", () => {
    for (const provider of [
      "groq",
      "openai",
      "anthropic",
      "gemini",
      "xai",
      "perplexity",
    ] as const) {
      expect(getLlmProviderDefinition(provider).defaultModel).not.toBe("");
    }
  });
});

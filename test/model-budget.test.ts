import { afterEach, describe, expect, it } from "vitest";
import {
  defaultLlmTokenBudget,
  resolveLlmTokenBudget,
} from "../src/llm/model-budget.js";

afterEach(() => {
  delete process.env.LLM_CONTEXT_WINDOW_TOKENS;
});

describe("resolveLlmTokenBudget", () => {
  it("reconnaît la fenêtre large de Gemini 3.x", () => {
    const budget = resolveLlmTokenBudget("gemini", "gemini-3.5-flash");
    expect(budget.contextWindowTokens).toBe(1_000_000);
    expect(budget.source).toBe("model");
    expect(budget.promptTokenBudget).toBeGreaterThan(100_000);
  });

  it("reconnaît la fenêtre de Llama 3.1 sur Groq", () => {
    const budget = resolveLlmTokenBudget("groq", "llama-3.1-8b-instant");
    expect(budget.contextWindowTokens).toBe(131_072);
    expect(budget.source).toBe("model");
  });

  it("réduit la réserve de réponse sur une très petite fenêtre", () => {
    const budget = resolveLlmTokenBudget("groq", "gemma-7b-it");
    expect(budget.contextWindowTokens).toBe(8_192);
    expect(budget.responseReserveTokens).toBeLessThan(3_000);
    expect(budget.promptTokenBudget).toBeGreaterThan(0);
  });

  it("privilégie LLM_CONTEXT_WINDOW_TOKENS quand il est défini", () => {
    process.env.LLM_CONTEXT_WINDOW_TOKENS = "20000";
    const budget = resolveLlmTokenBudget("gemini", "gemini-3.5-flash");
    expect(budget.contextWindowTokens).toBe(20_000);
    expect(budget.source).toBe("environment");
  });

  it("utilise un fallback prudent pour un backend custom inconnu", () => {
    const budget = defaultLlmTokenBudget();
    expect(budget.contextWindowTokens).toBe(16_384);
    expect(budget.source).toBe("provider-default");
  });
});

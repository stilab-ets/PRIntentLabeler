import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isRetryableLlmError,
  retryLlmRequest,
  LLM_RETRY_ATTEMPTS,
} from "../src/llm/retry.js";
import {
  LlmEmptyResponseError,
  LlmProviderRequestError,
  parseRetryAfterMs,
} from "../src/llm/provider-error.js";

describe("isRetryableLlmError", () => {
  it("réessaie les surcharges et throttlings du fournisseur", () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504]) {
      expect(
        isRetryableLlmError(new LlmProviderRequestError("X", status)),
      ).toBe(true);
    }
  });

  it("n’insiste pas sur une erreur définitive de configuration", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(
        isRetryableLlmError(new LlmProviderRequestError("X", status)),
      ).toBe(false);
    }
  });

  it("réessaie une coupure réseau ou un timeout", () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    expect(isRetryableLlmError(timeout)).toBe(true);
  });

  it("n’insiste pas sur une réponse vide, qui se reproduirait à l’identique", () => {
    expect(isRetryableLlmError(new LlmEmptyResponseError("Gemini"))).toBe(
      false,
    );
  });
});

describe("retryLlmRequest", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("réussit dès qu’une tentative aboutit après une surcharge", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new LlmProviderRequestError("Gemini", 503))
      .mockResolvedValueOnce("ok");

    const assertion = expect(retryLlmRequest(operation)).resolves.toBe("ok");
    await vi.runAllTimersAsync();
    await assertion;

    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("abandonne après le nombre de tentatives prévu et le signale", async () => {
    const operation = vi
      .fn()
      .mockRejectedValue(
        new LlmProviderRequestError("Gemini", 503, "high demand"),
      );

    // L'attente du rejet est branchée avant d'avancer les timers, sinon Vitest
    // voit un rejet momentanément non géré.
    const assertion = expect(retryLlmRequest(operation)).rejects.toThrow(
      `abandon après ${LLM_RETRY_ATTEMPTS} tentatives`,
    );
    await vi.runAllTimersAsync();
    await assertion;

    expect(operation).toHaveBeenCalledTimes(LLM_RETRY_ATTEMPTS);
  });

  it("n’effectue qu’un seul appel sur une erreur non réessayable", async () => {
    const operation = vi
      .fn()
      .mockRejectedValue(new LlmProviderRequestError("Gemini", 401));

    await expect(retryLlmRequest(operation)).rejects.toThrow("401");
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe("parseRetryAfterMs", () => {
  it("lit un délai exprimé en secondes", () => {
    expect(parseRetryAfterMs("2")).toBe(2_000);
  });

  it("ignore un en-tête absent ou illisible", () => {
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs("bientôt")).toBeUndefined();
  });
});

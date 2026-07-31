import { LlmProviderRequestError } from "./provider-error.js";

// Surcharge, throttling et pannes passagères des fournisseurs LLM : l'appel
// suivant réussit généralement, donc abandonner au premier échec fait perdre
// l'analyse pour rien.
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

// Erreurs réseau de fetch/undici : coupure, DNS, TLS ou dépassement du timeout.
const RETRYABLE_ERROR_NAMES = new Set([
  "AbortError",
  "TimeoutError",
  "TypeError",
  "FetchError",
]);

export const LLM_RETRY_ATTEMPTS = 3;
const BASE_DELAY_MS = 600;

// Un webhook GitHub doit rester court : on plafonne l'attente cumulée.
const MAX_DELAY_MS = 4_000;

export function isRetryableLlmError(error: unknown): boolean {
  if (error instanceof LlmProviderRequestError) {
    return RETRYABLE_STATUS_CODES.has(error.status);
  }
  return error instanceof Error && RETRYABLE_ERROR_NAMES.has(error.name);
}

// Le délai suggéré par le fournisseur prime sur le nôtre, sinon on double
// l'attente à chaque tentative avec un peu d'aléatoire pour éviter que
// plusieurs webhooks simultanés ne repartent exactement en même temps.
function computeDelayMs(error: unknown, attempt: number): number {
  const suggested =
    error instanceof LlmProviderRequestError ? error.retryAfterMs : undefined;
  if (suggested !== undefined) return Math.min(suggested, MAX_DELAY_MS);

  const exponential = BASE_DELAY_MS * 2 ** (attempt - 1);
  const jitter = Math.random() * BASE_DELAY_MS;
  return Math.min(exponential + jitter, MAX_DELAY_MS);
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

// Le nombre de tentatives est rappelé dans l'erreur finale, sinon un log de
// surcharge ne dit pas si l'application a insisté avant d'abandonner.
function annotateAttempts(error: unknown, attempts: number): unknown {
  if (!(error instanceof LlmProviderRequestError)) return error;

  return new LlmProviderRequestError(
    error.provider,
    error.status,
    `${error.detail ?? "aucun détail"} — abandon après ${attempts} tentatives`,
    error.retryAfterMs,
  );
}

export async function retryLlmRequest<T>(
  operation: () => Promise<T>,
  attempts = LLM_RETRY_ATTEMPTS,
): Promise<T> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableLlmError(error)) throw error;
      if (attempt === attempts) throw annotateAttempts(error, attempts);

      await wait(computeDelayMs(error, attempt));
    }
  }

  throw new Error("retryLlmRequest: aucune tentative exécutée.");
}

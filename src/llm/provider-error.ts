export class LlmProviderRequestError extends Error {
  public readonly detail?: string;

  constructor(
    public readonly provider: string,
    public readonly status: number,
    detail?: string,
    // Délai d'attente demandé par le fournisseur avant un nouvel essai.
    public readonly retryAfterMs?: number,
  ) {
    const safeDetail = detail?.replace(/\s+/g, " ").trim().slice(0, 240);
    super(
      `${provider} a rejeté la requête (${status})${safeDetail ? ` : ${safeDetail}` : ""}`,
    );
    this.name = "LlmProviderRequestError";
    this.detail = safeDetail;
  }
}

// En-tête `Retry-After` exprimé en secondes ou en date HTTP.
export function parseRetryAfterMs(
  headerValue: string | null,
): number | undefined {
  if (!headerValue) return undefined;

  const seconds = Number.parseFloat(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;

  const date = Date.parse(headerValue);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - Date.now());
}

// Un appel HTTP réussi mais sans texte exploitable est un échec du fournisseur,
// pas une classification « aucun label ne correspond ». Sans cette distinction,
// une réponse vide se transformait silencieusement en analyse sans suggestion.
export class LlmEmptyResponseError extends Error {
  constructor(
    public readonly provider: string,
    detail?: string,
  ) {
    const safeDetail = detail?.replace(/\s+/g, " ").trim().slice(0, 240);
    super(
      `${provider} a renvoyé une réponse vide${safeDetail ? ` (${safeDetail})` : ""}.`,
    );
    this.name = "LlmEmptyResponseError";
  }
}

// Le modèle a répondu, mais sa sortie ne respecte pas le contrat JSON.
export class LlmInvalidResponseError extends Error {
  constructor(detail: string) {
    super(
      `Réponse LLM invalide : ${detail.replace(/\s+/g, " ").slice(0, 240)}`,
    );
    this.name = "LlmInvalidResponseError";
  }
}

export class LlmProviderRequestError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status: number,
    detail?: string,
  ) {
    const safeDetail = detail?.replace(/\s+/g, " ").trim().slice(0, 240);
    super(
      `${provider} a rejeté la requête (${status})${safeDetail ? ` : ${safeDetail}` : ""}`,
    );
    this.name = "LlmProviderRequestError";
  }
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

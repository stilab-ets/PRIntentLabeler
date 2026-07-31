import {
  LlmEmptyResponseError,
  LlmInvalidResponseError,
  LlmProviderRequestError,
} from "./provider-error.js";

const RETRY_HINT =
  "Un nouveau commit ou une modification de la description relancera l'analyse.";

// Traduit l'échec technique en message actionnable : l'auteur de la PR doit
// savoir s'il doit attendre, corriger sa configuration ou signaler un bug.
export function describeLlmFailure(error: unknown): string {
  if (error instanceof LlmProviderRequestError) {
    if (error.status === 401 || error.status === 403) {
      return `${error.provider} a refusé la clé API configurée. Vérifie la configuration LLM de l'installation.`;
    }
    if (error.status === 404) {
      return `${error.provider} ne connaît pas le modèle demandé. Vérifie son nom dans la configuration LLM.`;
    }
    if (error.status === 429) {
      return `Le quota de ${error.provider} est atteint. ${RETRY_HINT}`;
    }
    if (error.status >= 500) {
      return `${error.provider} est temporairement surchargé ou indisponible. ${RETRY_HINT}`;
    }
    return `${error.provider} a rejeté la requête (${error.status}).`;
  }

  if (error instanceof LlmEmptyResponseError) {
    return `${error.provider} n'a renvoyé aucun texte exploitable. ${RETRY_HINT}`;
  }

  if (error instanceof LlmInvalidResponseError) {
    return `Le modèle n'a pas respecté le format JSON attendu. ${RETRY_HINT}`;
  }

  return `L'analyse LLM a échoué pour une raison inattendue. ${RETRY_HINT}`;
}

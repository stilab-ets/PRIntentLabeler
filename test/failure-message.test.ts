import { describe, expect, it } from "vitest";
import { describeLlmFailure } from "../src/llm/failure-message.js";
import {
  LlmEmptyResponseError,
  LlmInvalidResponseError,
  LlmProviderRequestError,
} from "../src/llm/provider-error.js";

describe("describeLlmFailure", () => {
  it("invite à réessayer quand le fournisseur est surchargé", () => {
    const message = describeLlmFailure(
      new LlmProviderRequestError("Gemini", 503, "high demand"),
    );
    expect(message).toContain("temporairement surchargé");
    expect(message).toContain("relancera l'analyse");
  });

  it("oriente vers la configuration quand la clé est refusée", () => {
    expect(
      describeLlmFailure(new LlmProviderRequestError("Gemini", 401)),
    ).toContain("clé API");
  });

  it("oriente vers le nom du modèle sur un 404", () => {
    expect(
      describeLlmFailure(new LlmProviderRequestError("Gemini", 404)),
    ).toContain("modèle");
  });

  it("distingue le quota atteint d’une panne", () => {
    expect(
      describeLlmFailure(new LlmProviderRequestError("Groq", 429)),
    ).toContain("quota");
  });

  it("explique une réponse vide et une sortie hors contrat", () => {
    expect(describeLlmFailure(new LlmEmptyResponseError("Gemini"))).toContain(
      "aucun texte exploitable",
    );
    expect(
      describeLlmFailure(new LlmInvalidResponseError("pas de JSON")),
    ).toContain("format JSON");
  });

  it("reste explicite face à une erreur inconnue", () => {
    expect(describeLlmFailure(new Error("boom"))).toContain(
      "raison inattendue",
    );
  });

  it("n’expose jamais le détail brut du fournisseur", () => {
    expect(
      describeLlmFailure(
        new LlmProviderRequestError("Gemini", 503, "clé=secret123"),
      ),
    ).not.toContain("secret123");
  });
});

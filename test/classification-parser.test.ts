import { describe, expect, it } from "vitest";
import {
  normalizeSuggestions,
  parsePullRequestAnalysis,
} from "../src/llm/classification-parser.js";

describe("parsePullRequestAnalysis", () => {
  it("normalise une réponse JSON valide", () => {
    expect(
      parsePullRequestAnalysis(
        JSON.stringify({
          suggestions: [
            { name: " feature ", confidence: 0.94, reason: " ajout " },
            { name: "bug", confidence: 0.2, reason: "correction" },
          ],
          summary: " Résumé ",
        }),
      ),
    ).toEqual({
      suggestions: [
        { name: "feature", confidence: 0.94, reason: "ajout" },
        { name: "bug", confidence: 0.2, reason: "correction" },
      ],
      summary: "Résumé",
    });
  });

  it("extrait le JSON d’un bloc Markdown", () => {
    const result = parsePullRequestAnalysis(
      '```json\n{"suggestions":[],"summary":"OK"}\n```',
    );
    expect(result).toEqual({ suggestions: [], summary: "OK" });
  });

  it("échoue au lieu de renvoyer une analyse vide quand la réponse n’a pas de JSON", () => {
    expect(() => parsePullRequestAnalysis("not json")).toThrow(
      "Réponse LLM invalide",
    );
  });

  it("échoue sur une réponse vide plutôt que de la confondre avec « aucun label »", () => {
    expect(() => parsePullRequestAnalysis("")).toThrow("réponse vide");
  });

  it("échoue sur un objet JSON tronqué", () => {
    expect(() =>
      parsePullRequestAnalysis('{"suggestions":[{"name":"bug"}'),
    ).toThrow("Réponse LLM invalide");
  });

  it("rejette les confiances hors contrat au lieu de les borner ou convertir", () => {
    expect(
      normalizeSuggestions([
        { name: "bug", confidence: 1.4, reason: "too high" },
        { name: "bug", confidence: -0.2, reason: "negative" },
        { name: "bug", confidence: "0.9", reason: "string" },
        { name: "bug", confidence: Number.NaN, reason: "NaN" },
        { name: "feature", confidence: 0.9, reason: "valid" },
      ]),
    ).toEqual([{ name: "feature", confidence: 0.9, reason: "valid" }]);
  });
});

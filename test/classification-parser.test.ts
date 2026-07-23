import { describe, expect, it } from "vitest";
import { parsePullRequestAnalysis } from "../src/llm/classification-parser.js";

describe("parsePullRequestAnalysis", () => {
  it("normalise une réponse JSON valide", () => {
    expect(
      parsePullRequestAnalysis(
        JSON.stringify({
          suggestions: [
            { name: " feature ", confidence: 1.4, reason: " ajout " },
            { name: "bug", confidence: -0.2, reason: "correction" },
          ],
          summary: " Résumé ",
        }),
      ),
    ).toEqual({
      suggestions: [
        { name: "feature", confidence: 1, reason: "ajout" },
        { name: "bug", confidence: 0, reason: "correction" },
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

  it("retourne une analyse vide pour une réponse invalide", () => {
    expect(parsePullRequestAnalysis("not json")).toEqual({
      suggestions: [],
      summary: "",
    });
  });
});

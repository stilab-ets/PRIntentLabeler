import { describe, it, expect } from "vitest";
import { filterValidSuggestions } from "../src/labels/label-policy.js";
import type { LabelSuggestion } from "../src/domain/label-suggestion.js";

describe("filterValidSuggestions", () => {
  const repoLabels = ["bug", "feature", "tests", "documentation"];

  it("retire les suggestions avec une confidence trop basse", () => {
    const suggestions: LabelSuggestion[] = [
      { name: "bug", confidence: 0.5, reason: "" },
      { name: "feature", confidence: 0.9, reason: "" },
    ];

    const result = filterValidSuggestions(suggestions, repoLabels, 0.7);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("feature");
  });

  it("retire les labels qui ne sont pas dans le repo", () => {
    const suggestions: LabelSuggestion[] = [
      { name: "unknown-label", confidence: 0.95, reason: "" },
      { name: "bug", confidence: 0.85, reason: "" },
    ];

    const result = filterValidSuggestions(suggestions, repoLabels);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("bug");
  });

  it("limite à maxLabels suggestions triées par confidence décroissante", () => {
    const suggestions: LabelSuggestion[] = [
      { name: "bug", confidence: 0.85, reason: "" },
      { name: "feature", confidence: 0.95, reason: "" },
      { name: "tests", confidence: 0.75, reason: "" },
      { name: "documentation", confidence: 0.9, reason: "" },
    ];

    const result = filterValidSuggestions(suggestions, repoLabels, 0.7, 3);
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.name)).toEqual([
      "feature",
      "documentation",
      "bug",
    ]);
  });

  it("déduplique les labels", () => {
    const suggestions: LabelSuggestion[] = [
      { name: "bug", confidence: 0.71, reason: "weak first" },
      { name: "Bug", confidence: 0.98, reason: "strong duplicate" },
    ];

    const result = filterValidSuggestions(suggestions, repoLabels);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.98);
    expect(result[0].reason).toBe("strong duplicate");
  });

  it("restaure la casse exacte du label GitHub", () => {
    const suggestions: LabelSuggestion[] = [
      { name: "type: bug", confidence: 0.85, reason: "" },
    ];

    const result = filterValidSuggestions(suggestions, ["Type: Bug"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Type: Bug");
  });

  it("rejette les sorties malformées sans coercition", () => {
    const result = filterValidSuggestions(
      [
        null,
        "bug",
        { name: null, confidence: 0.9 },
        { name: "bug", confidence: "0.9", reason: "string confidence" },
        { name: "bug", confidence: Number.NaN, reason: "NaN" },
        { name: "bug", confidence: 1.1, reason: "too high" },
        { name: "BUG", confidence: 0.91, reason: "valid" },
      ],
      repoLabels,
    );

    expect(result).toEqual([
      { name: "bug", confidence: 0.91, reason: "valid" },
    ]);
  });
});

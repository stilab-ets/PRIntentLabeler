import { describe, it, expect } from "vitest";
import {
  resolveLabelMode,
  selectLabelsToApply,
  selectSuggestedLabelsBelowThreshold,
} from "../src/labels/label-mode.js";
import type { LabelSuggestion } from "../src/domain/label-suggestion.js";

const suggestions: LabelSuggestion[] = [
  { name: "bug", confidence: 0.91, reason: "corrige un crash" },
  { name: "security", confidence: 0.86, reason: "auth" },
  { name: "tests", confidence: 0.74, reason: "ajout de tests" },
];

describe("resolveLabelMode", () => {
  it("retombe sur suggest par défaut", () => {
    expect(resolveLabelMode(undefined)).toBe("suggest");
    expect(resolveLabelMode("")).toBe("suggest");
    expect(resolveLabelMode("valeur-inconnue")).toBe("suggest");
  });

  it("reconnaît auto-high (insensible à la casse et aux séparateurs)", () => {
    expect(resolveLabelMode("auto-high")).toBe("auto-high");
    expect(resolveLabelMode("AUTO_HIGH")).toBe("auto-high");
    expect(resolveLabelMode("high")).toBe("auto-high");
  });

  it("reconnaît auto-all", () => {
    expect(resolveLabelMode("auto-all")).toBe("auto-all");
    expect(resolveLabelMode("ALL")).toBe("auto-all");
  });
});

describe("selectLabelsToApply", () => {
  it("n'applique aucun label en mode suggest", () => {
    expect(selectLabelsToApply(suggestions, "suggest")).toEqual([]);
  });

  it("applique seulement les labels au-dessus du seuil en auto-high", () => {
    const result = selectLabelsToApply(suggestions, "auto-high");
    expect(result.map((s) => s.name)).toEqual(["bug", "security"]);
  });

  it("applique tous les labels retenus en auto-all", () => {
    const result = selectLabelsToApply(suggestions, "auto-all");
    expect(result.map((s) => s.name)).toEqual(["bug", "security", "tests"]);
  });

  it("respecte la limite maximale de labels en auto-all", () => {
    const many: LabelSuggestion[] = [
      { name: "a", confidence: 0.99, reason: "" },
      { name: "b", confidence: 0.98, reason: "" },
      { name: "c", confidence: 0.97, reason: "" },
      { name: "d", confidence: 0.96, reason: "" },
    ];
    const result = selectLabelsToApply(many, "auto-all", 0.85, 3);
    expect(result.map((s) => s.name)).toEqual(["a", "b", "c"]);
  });

  it("respecte un seuil personnalisé en auto-high", () => {
    const result = selectLabelsToApply(suggestions, "auto-high", 0.9);
    expect(result.map((s) => s.name)).toEqual(["bug"]);
  });
});

describe("selectSuggestedLabelsBelowThreshold", () => {
  it("retire les labels suggérés présents sur la PR sous le seuil", () => {
    const result = selectSuggestedLabelsBelowThreshold(
      suggestions,
      ["bug", "tests", "wontfix"],
    );
    expect(result).toEqual(["tests"]);
  });

  it("ne retire pas les labels hors suggestions ni ceux au-dessus du seuil", () => {
    const result = selectSuggestedLabelsBelowThreshold(
      suggestions,
      ["security", "wontfix"],
    );
    expect(result).toEqual([]);
  });

  it("reconnaît les labels sous leur forme préfixée 🤖 et retourne le nom exact", () => {
    const result = selectSuggestedLabelsBelowThreshold(suggestions, [
      "🤖 tests",
      "🤖 security",
    ]);
    expect(result).toEqual(["🤖 tests"]);
  });
});

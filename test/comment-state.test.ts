import { describe, it, expect } from "vitest";
import {
  renderAnalysisDataBlock,
  parseAnalysisDataBlock,
  renderCheckboxLines,
  parseCheckedLabels,
  parseAllCheckboxLabels,
} from "../src/comments/comment-state.js";
import type { PullRequestAnalysis } from "../src/domain/llm-analysis.js";

const analysis: PullRequestAnalysis = {
  suggestions: [
    { name: "bug", confidence: 0.88, reason: "corrige un crash" },
    { name: "tests", confidence: 0.72, reason: "ajoute des tests" },
  ],
  summary: "Corrige un bug et ajoute des tests.",
};

describe("bloc data du commentaire", () => {
  it("encode puis décode l'analyse sans perte", () => {
    const block = renderAnalysisDataBlock(analysis);
    const parsed = parseAnalysisDataBlock(`du texte\n${block}\nautre texte`);
    expect(parsed).toEqual(analysis);
  });

  it("retourne null si aucun bloc data", () => {
    expect(parseAnalysisDataBlock("commentaire sans bloc")).toBeNull();
  });
});

describe("cases à cocher", () => {
  it("rend une ligne par suggestion, cochée selon l'état, avec le nom préfixé par l'icône IA", () => {
    const lines = renderCheckboxLines(analysis.suggestions, ["bug"]);
    expect(lines).toContain("- [x] `🤖 bug`");
    expect(lines).toContain("- [ ] `🤖 tests`");
  });

  it("extrait uniquement les labels cochés, sans le préfixe IA", () => {
    const body = "- [x] `🤖 bug` — 88%\n- [ ] `🤖 tests` — 72%";
    expect(parseCheckedLabels(body)).toEqual(["bug"]);
  });

  it("extrait tous les labels présents dans les cases, sans le préfixe IA", () => {
    const body = "- [x] `🤖 bug` — 88%\n- [ ] `🤖 tests` — 72%";
    expect(parseAllCheckboxLabels(body)).toEqual(["bug", "tests"]);
  });
});

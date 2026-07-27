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
  it("signe puis vérifie l'analyse et le headSha sans perte", () => {
    const block = renderAnalysisDataBlock(analysis, "sha-123", "secret");
    const parsed = parseAnalysisDataBlock(
      `du texte\n${block}\nautre texte`,
      "secret",
    );
    expect(parsed).toEqual({
      version: 3,
      headSha: "sha-123",
      analysis,
      verified: true,
    });
  });

  it("rejette un bloc signé qui a été modifié", () => {
    const block = renderAnalysisDataBlock(analysis, "sha-123", "secret");
    const tampered = block.replace("a", "b");
    expect(parseAnalysisDataBlock(tampered, "secret")).toBeNull();
  });

  it("retourne null si aucun bloc data", () => {
    expect(parseAnalysisDataBlock("commentaire sans bloc")).toBeNull();
  });

  it("parse un ancien bloc v1 (sans version ni headSha) sans planter", () => {
    const legacyBlock = `<!-- llm-pr-labeler:data ${Buffer.from(
      JSON.stringify(analysis),
      "utf8",
    ).toString("base64")} -->`;

    const parsed = parseAnalysisDataBlock(legacyBlock);
    expect(parsed).toEqual({
      version: 1,
      headSha: null,
      analysis,
      verified: false,
    });
  });

  it("retourne null pour un blob base64 invalide", () => {
    expect(
      parseAnalysisDataBlock("<!-- llm-pr-labeler:data bm90LWpzb24= -->"),
    ).toBeNull();
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

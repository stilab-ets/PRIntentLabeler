import { describe, expect, it } from "vitest";
import { selectCandidateLabels } from "../src/llm/label-selector.js";

describe("selectCandidateLabels", () => {
  it("conserve l'ordre et tous les labels sous la limite", () => {
    expect(selectCandidateLabels(["zeta", "bug"], {}, 10)).toEqual([
      "zeta",
      "bug",
    ]);
  });

  it("priorise les labels d'intention dans une grande taxonomie", () => {
    const metaLabels = Array.from(
      { length: 60 },
      (_, index) => `area/${index}`,
    );
    const labels = [...metaLabels, "kind/bug", "documentation", "size/L"];

    const selected = selectCandidateLabels(labels, {}, 10);

    expect(selected).toContain("kind/bug");
    expect(selected).toContain("documentation");
    expect(selected).not.toContain("size/L");
  });

  it("utilise aussi la description pour reconnaître un label personnalisé", () => {
    const labels = [
      ...Array.from({ length: 10 }, (_, index) => `team-${index}`),
      "correctness",
    ];

    const selected = selectCandidateLabels(
      labels,
      { correctness: "Fixes a bug in existing behavior" },
      2,
    );

    expect(selected).toContain("correctness");
  });
});

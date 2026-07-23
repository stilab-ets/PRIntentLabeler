import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  truncatePatch,
  truncateFilePatch,
} from "../src/llm/patch-utils.js";
import type { PullRequestFileData } from "../src/domain/pull-request-data.js";

describe("truncatePatch", () => {
  it("retourne undefined si le patch est undefined", () => {
    expect(truncatePatch(undefined, 10)).toBeUndefined();
  });

  it("ne modifie pas un patch court", () => {
    const patch = "line1\nline2\nline3";
    expect(truncatePatch(patch, 10)).toBe(patch);
  });

  it("tronque un patch trop long", () => {
    const patch = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n");
    const result = truncatePatch(patch, 5);
    expect(result).toBeDefined();
    expect(result!.split("\n").length).toBeLessThan(20);
  });

  it("ajoute le texte indiquant les lignes tronquées", () => {
    const patch = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n");
    const result = truncatePatch(patch, 5);
    expect(result).toContain("(15 more lines truncated)");
  });

  it("conserve aussi la fin d'un patch tronqué", () => {
    const patch = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n");
    const result = truncatePatch(patch, 5);
    expect(result).toContain("line19");
  });

  it("borne également les très longues lignes par caractères", () => {
    const result = truncatePatch(`+${"x".repeat(5_000)}`, 10, 500);
    expect(result).toBeDefined();
    expect(result!.length).toBeLessThanOrEqual(500);
    expect(result).toContain("characters truncated");
  });

  it("respecte aussi une limite plus courte que le marqueur", () => {
    const result = truncatePatch("x".repeat(100), 10, 10);
    expect(result).toHaveLength(10);
  });
});

describe("estimateTokens", () => {
  it("estime le coût avec la convention de quatre caractères par token", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens(undefined)).toBe(0);
  });
});

describe("truncateFilePatch", () => {
  it("tronque le patch du fichier sans muter l'original", () => {
    const file: PullRequestFileData = {
      filename: "src/a.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
      changes: 1,
      patch: Array.from({ length: 200 }, (_, i) => `l${i}`).join("\n"),
    };
    const result = truncateFilePatch(file, 10);
    expect(result.patch).toContain("more lines truncated");
    expect(file.patch!.split("\n").length).toBe(200);
  });
});

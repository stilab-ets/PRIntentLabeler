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

  it("tronque un patch trop long sans structure de hunk (repli tête/queue)", () => {
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

  it("conserve aussi la fin d'un patch tronqué sans hunks", () => {
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

  it("conserve les headers de hunk (@@) lors de la troncature", () => {
    const patch = [
      "@@ -1,5 +1,5 @@",
      " context1",
      " context2",
      "-old line",
      "+new line",
      " context3",
      "@@ -20,5 +20,6 @@",
      " context4",
      "-old2",
      "+new2",
      " context5",
    ].join("\n");

    const result = truncatePatch(patch, 6, 10_000);
    expect(result).toContain("@@ -1,5 +1,5 @@");
    expect(result).toContain("@@ -20,5 +20,6 @@");
  });

  it("conserve un changement important situé au milieu d'un patch à plusieurs hunks", () => {
    const patch = [
      "@@ -1,6 +1,6 @@",
      " context1",
      " context2",
      "-old line",
      "+new line",
      " context3",
      " context4",
      "@@ -20,6 +20,7 @@",
      " context5",
      " context6",
      "-removed important line",
      "+ADDED_IMPORTANT_MARKER",
      " context7",
      " context8",
      "@@ -40,6 +41,6 @@",
      " context9",
      " context10",
      "-old2",
      "+new2",
      " context11",
      " context12",
    ].join("\n");

    const result = truncatePatch(patch, 12, 10_000);
    expect(result).toContain("ADDED_IMPORTANT_MARKER");
  });

  it("ne traite jamais une ligne +++/--- comme une ligne changée prioritaire", () => {
    const patch = [
      "@@ -1,2 +1,3 @@",
      "+++ b/looks-like-a-header-but-is-just-context",
      "-actual removed line",
      "+actual added line",
    ].join("\n");

    const result = truncatePatch(patch, 3, 10_000);
    expect(result).toContain("actual removed line");
    expect(result).toContain("actual added line");
    expect(result).not.toContain("looks-like-a-header-but-is-just-context");
  });

  it("respecte toujours maxLines même avec plusieurs hunks volumineux", () => {
    const hunk = (start: number) =>
      [
        `@@ -${start},10 +${start},10 @@`,
        ...Array.from({ length: 10 }, (_, i) => ` context${start}_${i}`),
        `-old${start}`,
        `+new${start}`,
      ].join("\n");

    const patch = [hunk(1), hunk(20), hunk(40), hunk(60)].join("\n");
    const result = truncatePatch(patch, 15, 10_000);
    expect(result!.split("\n").length).toBeLessThanOrEqual(15);
  });

  it("est déterministe (même entrée -> même sortie)", () => {
    const patch = [
      "@@ -1,4 +1,4 @@",
      " a",
      "-b",
      "+c",
      " d",
      "@@ -10,4 +10,4 @@",
      " e",
      "-f",
      "+g",
      " h",
    ].join("\n");

    const first = truncatePatch(patch, 6, 10_000);
    const second = truncatePatch(patch, 6, 10_000);
    expect(first).toBe(second);
  });
});

describe("estimateTokens", () => {
  it("estime le coût avec la convention de trois caractères par token", () => {
    expect(estimateTokens("abc")).toBe(1);
    expect(estimateTokens("abcd")).toBe(2);
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

import { describe, it, expect } from "vitest";
import {
  classifyFileRole,
  inferPreferredFileRoles,
  shouldIgnoreFile,
  scoreFile,
  rankFilesByImportance,
  selectRepresentativeFiles,
} from "../src/llm/file-selector.js";
import type { PullRequestFileData } from "../src/domain/pull-request-data.js";

function file(
  filename: string,
  overrides: Partial<PullRequestFileData> = {},
): PullRequestFileData {
  return {
    filename,
    status: "modified",
    additions: 5,
    deletions: 0,
    changes: 5,
    ...overrides,
  };
}

describe("shouldIgnoreFile", () => {
  it("ignore les lockfiles", () => {
    expect(shouldIgnoreFile("package-lock.json")).toBe(true);
  });

  it("ignore les fichiers dans dist/", () => {
    expect(shouldIgnoreFile("dist/bundle.js")).toBe(true);
  });

  it("ne confond pas un répertoire source build avec un artefact généré", () => {
    expect(shouldIgnoreFile("src/build/create-bundle.ts")).toBe(false);
  });

  it("ignore les images", () => {
    expect(shouldIgnoreFile("image.png")).toBe(true);
  });

  it("ignore les fichiers minifiés", () => {
    expect(shouldIgnoreFile("file.min.js")).toBe(true);
  });

  it("ignore les source maps", () => {
    expect(shouldIgnoreFile("file.map")).toBe(true);
  });

  it("ne pas ignorer le code source", () => {
    expect(shouldIgnoreFile("src/auth/login.ts")).toBe(false);
  });

  it("ne pas ignorer les fichiers de test", () => {
    expect(shouldIgnoreFile("tests/login.spec.ts")).toBe(false);
  });

  it("ne pas ignorer le README", () => {
    expect(shouldIgnoreFile("README.md")).toBe(false);
  });

  it("conserve les SVG textuels comme preuve visuelle potentielle", () => {
    expect(shouldIgnoreFile("src/icons/new-action.svg")).toBe(false);
    expect(classifyFileRole("src/icons/new-action.svg")).toBe("asset");
  });
});

describe("scoreFile / rankFilesByImportance", () => {
  it("score un fichier source auth plus haut qu'un README normal", () => {
    const source = scoreFile(file("src/auth/login.ts"));
    const readme = scoreFile(file("README.md"));
    expect(source).toBeGreaterThan(readme);
  });

  it("évite les faux signaux causés par des sous-chaînes", () => {
    const author = rankFilesByImportance([file("src/author.ts")])[0];
    const feedback = rankFilesByImportance([file("src/feedback.ts")])[0];
    const inventory = rankFilesByImportance([file("src/inventory.ts")])[0];
    const perfect = rankFilesByImportance([file("src/perfect-match.ts")])[0];

    expect(author.reasons).not.toContain("security signal");
    expect(feedback.role).toBe("source");
    expect(inventory.role).toBe("source");
    expect(perfect.reasons).not.toContain("performance signal");
  });

  it("reconnaît les signaux dans les noms camelCase", () => {
    const ranked = rankFilesByImportance([
      file("src/authService.ts"),
      file("src/cacheManager.ts"),
    ]);

    expect(
      ranked.find((entry) => entry.file.filename === "src/authService.ts")
        ?.reasons,
    ).toContain("security signal");
    expect(
      ranked.find((entry) => entry.file.filename === "src/cacheManager.ts")
        ?.reasons,
    ).toContain("performance signal");
  });

  it("donne un score pertinent à un workflow CI/CD", () => {
    const ranked = rankFilesByImportance([file(".github/workflows/ci.yml")]);
    expect(ranked[0].score).toBeGreaterThan(0);
    expect(ranked[0].role).toBe("ci-cd");
    expect(ranked[0].reasons).toContain("ci-cd role");
  });

  it("marque les fichiers ignorés avec un score négatif", () => {
    const ranked = rankFilesByImportance([file("package-lock.json")]);
    expect(ranked[0].ignored).toBe(true);
    expect(ranked[0].score).toBeLessThan(0);
  });

  it("trie les fichiers par score décroissant", () => {
    const ranked = rankFilesByImportance([
      file("README.md"),
      file("src/auth/login.ts"),
      file("package-lock.json"),
    ]);
    const scores = ranked.map((r) => r.score);
    const sorted = [...scores].sort((a, b) => b - a);
    expect(scores).toEqual(sorted);
    expect(ranked[0].file.filename).toBe("src/auth/login.ts");
  });

  it("utilise le nom comme départage déterministe à score égal", () => {
    const ranked = rankFilesByImportance([file("src/b.ts"), file("src/a.ts")]);

    expect(ranked.map((entry) => entry.file.filename)).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("attribue un rôle test exclusif même lorsque le test est sous src/", () => {
    const ranked = rankFilesByImportance([
      file("src/auth/login.ts", { changes: 50, patch: "+code" }),
      file("src/auth/login.test.ts", { changes: 50, patch: "+test" }),
    ]);

    expect(ranked[0].role).toBe("source");
    expect(ranked[1].role).toBe("test");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("reconnaît les conventions de tests Go et Python", () => {
    expect(classifyFileRole("pkg/events/broadcaster_test.go")).toBe("test");
    expect(classifyFileRole("module/test_parser.py")).toBe("test");
  });

  it("déduit le rôle préféré des titres Conventional Commits", () => {
    expect(inferPreferredFileRoles("docs(api): clarify hooks")).toEqual([
      "documentation",
    ]);
    expect(inferPreferredFileRoles("chore(deps): bump vite")).toEqual([
      "dependency",
    ]);
    expect(inferPreferredFileRoles("test: stabilize fixture")).toEqual([
      "test",
    ]);
    expect(inferPreferredFileRoles("feat(docker): add image target")).toEqual([
      "source",
      "database",
      "configuration",
    ]);
  });

  it("utilise le titre comme signal sans exclure les autres rôles", () => {
    const ranked = rankFilesByImportance([
      file("src/generator.ts", { changes: 10, patch: "+source" }),
      file("docs/guide.md", { changes: 10, patch: "+docs" }),
    ]);

    const selected = selectRepresentativeFiles(
      ranked,
      2,
      inferPreferredFileRoles("docs: regenerate guide"),
    );
    expect(selected[0].role).toBe("documentation");
    expect(selected[1].role).toBe("source");
  });

  it("diversifie la sélection au lieu de retenir uniquement des tests", () => {
    const ranked = rankFilesByImportance([
      file("src/feature.ts", { changes: 80, patch: "+source" }),
      file("src/feature.test.ts", { changes: 80, patch: "+test 1" }),
      file("src/feature-edge.test.ts", { changes: 80, patch: "+test 2" }),
      file("src/__snapshots__/feature.snap", {
        changes: 80,
        patch: "+snapshot",
      }),
      file("docs/feature.md", { changes: 30, patch: "+docs" }),
    ]);

    const selected = selectRepresentativeFiles(ranked, 3);
    expect(selected[0].file.filename).toBe("src/feature.ts");
    expect(selected.map((entry) => entry.role)).toContain("documentation");
    expect(selected.filter((entry) => entry.role === "test")).toHaveLength(1);
  });
});

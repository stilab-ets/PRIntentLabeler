import { describe, expect, it } from "vitest";
import type {
  PullRequestData,
  PullRequestFileData,
} from "../src/domain/pull-request-data.js";
import {
  buildAblationContexts,
  calculateSetMetrics,
  selectRandomRepresentativeFiles,
} from "../src/evaluation/selector-ablation.js";
import { rankFilesByImportance } from "../src/llm/file-selector.js";
import { buildClassificationPromptForAblation } from "../src/llm/prompt-builder.js";

function file(
  filename: string,
  patch: string | undefined = "+change",
): PullRequestFileData {
  return {
    filename,
    status: "modified",
    additions: 1,
    deletions: 0,
    changes: 1,
    patch,
  };
}

function data(): PullRequestData {
  const files = [
    file("src/a.ts"),
    file("src/b.ts"),
    file("test/a.test.ts"),
    file("docs/guide.md"),
    file("package.json"),
    file("package-lock.json", "+lock"),
    file("feature.snap", "+snapshot"),
    file("src/generated/api.pb.go", "+generated"),
    file("src/no-diff.ts", ""),
  ];

  return {
    owner: "org",
    repo: "repo",
    number: 1,
    title: "fix invoice",
    body: "description",
    author: "author",
    baseBranch: "main",
    headBranch: "fix",
    headSha: "sha",
    htmlUrl: "",
    additions: files.length,
    deletions: 0,
    changedFilesCount: files.length,
    files,
    repositoryLabels: ["bug", "feature"],
    pullRequestLabels: [],
  };
}

describe("selector ablation", () => {
  it("produit une sélection aléatoire déterministe avec une seed fixe", () => {
    const prData = data();
    const ranked = rankFilesByImportance(prData.files, {
      title: prData.title,
      body: prData.body,
    });
    const first = selectRandomRepresentativeFiles(ranked, 6, 12345);
    const second = selectRandomRepresentativeFiles(ranked, 6, 12345);

    expect(first.map((entry) => entry.file.filename)).toEqual(
      second.map((entry) => entry.file.filename),
    );
  });

  it("exclut les contenus non admissibles de la variante aléatoire", () => {
    const prData = data();
    const ranked = rankFilesByImportance(prData.files);
    const names = selectRandomRepresentativeFiles(ranked, 20, 42).map(
      (entry) => entry.file.filename,
    );

    expect(names).not.toContain("package-lock.json");
    expect(names).not.toContain("feature.snap");
    expect(names).not.toContain("src/generated/api.pb.go");
    expect(names).not.toContain("src/no-diff.ts");
  });

  it("isole titre, rôles et diffs selon les quatre variantes", () => {
    const contexts = buildAblationContexts(data(), 42);
    const title = buildClassificationPromptForAblation(
      contexts["A-title"],
      "A-title",
    );
    const roles = buildClassificationPromptForAblation(
      contexts["B-title-roles"],
      "B-title-roles",
    );
    const scored = buildClassificationPromptForAblation(
      contexts["C-scored-diffs"],
      "C-scored-diffs",
    );
    const random = buildClassificationPromptForAblation(
      contexts["D-random-diffs"],
      "D-random-diffs",
    );

    expect(title).not.toContain("## Change Roles");
    expect(title).not.toContain("## Representative Diffs");
    expect(roles).toContain("## Change Roles");
    expect(roles).not.toContain("## Representative Diffs");
    expect(scored).toContain("## Representative Diffs");
    expect(random).toContain("## Representative Diffs");
    for (const prompt of [title, roles, scored, random]) {
      expect(prompt).toContain('- {"name":"bug"}');
      expect(prompt).toContain('- {"name":"feature"}');
      expect(prompt).not.toMatch(/\d+\s*(pts|\/20)/);
    }
  });

  it("calcule exact-set accuracy, précision, rappel, F1 et Jaccard", () => {
    expect(calculateSetMetrics(["bug", "security"], ["bug", "tests"])).toEqual({
      exactSetAccuracy: 0,
      precision: 0.5,
      recall: 0.5,
      f1: 0.5,
      jaccard: 1 / 3,
    });
    expect(calculateSetMetrics(["BUG"], ["bug"])).toEqual({
      exactSetAccuracy: 1,
      precision: 1,
      recall: 1,
      f1: 1,
      jaccard: 1,
    });
  });
});

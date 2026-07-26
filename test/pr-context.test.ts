import { describe, it, expect } from "vitest";
import { buildPullRequestLlmContext } from "../src/llm/pr-context.js";
import type {
  PullRequestData,
  PullRequestFileData,
} from "../src/domain/pull-request-data.js";
import {
  MAX_FILES_FOR_LLM,
  MAX_REPOSITORY_LABELS_FOR_LLM,
  MAX_TOTAL_PATCH_CHARS,
  MAX_TOTAL_PATCH_TOKENS,
} from "../src/utils/constants.js";
import { estimateTokens } from "../src/llm/patch-utils.js";

function baseData(files: PullRequestFileData[]): PullRequestData {
  return {
    owner: "org",
    repo: "repo",
    number: 7,
    title: "Some PR",
    body: "body",
    author: "talip",
    baseBranch: "main",
    headBranch: "feat",
    headSha: "abc123",
    htmlUrl: "https://github.com/org/repo/pull/7",
    additions: 10,
    deletions: 2,
    changedFilesCount: files.length,
    files,
    repositoryLabels: ["bug", "tests"],
    pullRequestLabels: [],
  };
}

describe("buildPullRequestLlmContext", () => {
  it("retourne les infos repository et pullRequest", () => {
    const ctx = buildPullRequestLlmContext(
      baseData([
        {
          filename: "src/a.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          changes: 1,
        },
      ]),
    );
    expect(ctx.repository).toEqual({ owner: "org", repo: "repo" });
    expect(ctx.pullRequest.number).toBe(7);
    expect(ctx.pullRequest.title).toBe("Some PR");
  });

  it("inclut score, role et contentPolicy dans allFilesSummary", () => {
    const ctx = buildPullRequestLlmContext(
      baseData([
        {
          filename: "src/a.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          changes: 1,
        },
        {
          filename: "package-lock.json",
          status: "modified",
          additions: 1,
          deletions: 0,
          changes: 1,
        },
      ]),
    );
    expect(ctx.allFilesSummary.length).toBe(2);
    for (const summary of ctx.allFilesSummary) {
      expect(summary).toHaveProperty("score");
      expect(summary).toHaveProperty("role");
      expect(summary).toHaveProperty("contentPolicy");
    }
    const lockfile = ctx.allFilesSummary.find(
      (f) => f.filename === "package-lock.json",
    );
    expect(lockfile?.role).toBe("dependency");
    expect(lockfile?.contentPolicy).toBe("summary-only");
  });

  it("exclut les fichiers generated/summary-only des selectedFiles", () => {
    const ctx = buildPullRequestLlmContext(
      baseData([
        {
          filename: "src/a.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          changes: 1,
          patch: "+a",
        },
        {
          filename: "dist/bundle.js",
          status: "modified",
          additions: 1,
          deletions: 0,
          changes: 1,
          patch: "+bundle",
        },
      ]),
    );
    const names = ctx.selectedFiles.map((r) => r.file.filename);
    expect(names).toContain("src/a.ts");
    expect(names).not.toContain("dist/bundle.js");
    expect(ctx.summaryOnlyFilesCount).toBe(1);
  });

  it("ne compte jamais un lockfile ou un snapshot comme sélectionné, mais les compte en summary-only", () => {
    const ctx = buildPullRequestLlmContext(
      baseData([
        {
          filename: "src/a.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          changes: 1,
          patch: "+a",
        },
        {
          filename: "package-lock.json",
          status: "modified",
          additions: 500,
          deletions: 0,
          changes: 500,
          patch: "+huge lockfile diff",
        },
        {
          filename: "src/__snapshots__/a.snap",
          status: "modified",
          additions: 50,
          deletions: 0,
          changes: 50,
          patch: "+snapshot content",
        },
      ]),
    );
    const names = ctx.selectedFiles.map((r) => r.file.filename);
    expect(names).not.toContain("package-lock.json");
    expect(names).not.toContain("src/__snapshots__/a.snap");
    expect(ctx.summaryOnlyFilesCount).toBe(2);
  });

  it("limite selectedFiles à MAX_FILES_FOR_LLM", () => {
    const files: PullRequestFileData[] = Array.from({ length: 20 }, (_, i) => ({
      filename: `src/file${i}.ts`,
      status: "modified",
      additions: 1,
      deletions: 0,
      changes: 1,
      patch: `+line${i}`,
    }));
    const ctx = buildPullRequestLlmContext(baseData(files));
    expect(ctx.selectedFiles.length).toBe(MAX_FILES_FOR_LLM);
    expect(ctx.selectedFilesCount).toBe(MAX_FILES_FOR_LLM);
  });

  it("tronque les patchs des fichiers sélectionnés", () => {
    const longPatch = Array.from({ length: 200 }, (_, i) => `l${i}`).join("\n");
    const ctx = buildPullRequestLlmContext(
      baseData([
        {
          filename: "src/a.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          changes: 1,
          patch: longPatch,
        },
      ]),
    );
    expect(ctx.selectedFiles[0].file.patch).toContain("more lines truncated");
  });

  it("respecte le budget global de caractères des patchs", () => {
    const files: PullRequestFileData[] = Array.from({ length: 6 }, (_, i) => ({
      filename: `src/file${i}.ts`,
      status: "modified",
      additions: 100,
      deletions: 0,
      changes: 100,
      patch: Array.from({ length: 100 }, () => `+${"x".repeat(200)}`).join(
        "\n",
      ),
    }));

    const ctx = buildPullRequestLlmContext(baseData(files));
    const totalPatchCharacters = ctx.selectedFiles.reduce(
      (total, selected) => total + (selected.file.patch?.length ?? 0),
      0,
    );

    expect(totalPatchCharacters).toBeLessThanOrEqual(MAX_TOTAL_PATCH_CHARS);
  });

  it("respecte le budget global estimé en tokens", () => {
    const files: PullRequestFileData[] = Array.from({ length: 6 }, (_, i) => ({
      filename: `src/file${i}.ts`,
      status: "modified",
      additions: 100,
      deletions: 0,
      changes: 100,
      patch: `+${"x".repeat(20_000)}`,
    }));

    const ctx = buildPullRequestLlmContext(baseData(files));
    const estimatedTokens = ctx.selectedFiles.reduce(
      (total, selected) => total + estimateTokens(selected.file.patch),
      0,
    );

    expect(estimatedTokens).toBeLessThanOrEqual(MAX_TOTAL_PATCH_TOKENS);
  });

  it("réduit le budget des patchs quand les métadonnées de la PR sont très volumineuses", () => {
    const files: PullRequestFileData[] = Array.from({ length: 6 }, (_, i) => ({
      filename: `src/file${i}.ts`,
      status: "modified",
      additions: 100,
      deletions: 0,
      changes: 100,
      patch: `+${"x".repeat(5_000)}`,
    }));

    const smallData = baseData(files);
    const hugeData = {
      ...baseData(files),
      body: "x".repeat(50_000),
      repositoryLabels: Array.from({ length: 30 }, (_, i) => `label-${i}`),
      repositoryLabelDescriptions: Object.fromEntries(
        Array.from({ length: 30 }, (_, i) => [
          `label-${i}`,
          "a fairly long description that repeats a lot of filler text ".repeat(
            5,
          ),
        ]),
      ),
    };

    const smallCtx = buildPullRequestLlmContext(smallData);
    const hugeCtx = buildPullRequestLlmContext(hugeData);

    const smallTotal = smallCtx.selectedFiles.reduce(
      (total, s) => total + estimateTokens(s.file.patch),
      0,
    );
    const hugeTotal = hugeCtx.selectedFiles.reduce(
      (total, s) => total + estimateTokens(s.file.patch),
      0,
    );

    expect(hugeTotal).toBeLessThanOrEqual(smallTotal);
  });

  it("résume la distribution des rôles de fichiers, en incluant les lockfiles/snapshots et en excluant le bruit généré", () => {
    const ctx = buildPullRequestLlmContext(
      baseData([
        {
          filename: "src/a.ts",
          status: "modified",
          additions: 10,
          deletions: 0,
          changes: 10,
        },
        {
          filename: "test/a.test.ts",
          status: "modified",
          additions: 20,
          deletions: 0,
          changes: 20,
        },
        {
          filename: "package-lock.json",
          status: "modified",
          additions: 5,
          deletions: 0,
          changes: 5,
        },
        {
          filename: "dist/bundle.js",
          status: "modified",
          additions: 999,
          deletions: 0,
          changes: 999,
        },
      ]),
    );

    expect(ctx.fileRoleSummary).toEqual(
      expect.arrayContaining([
        { role: "source", files: 1, changes: 10 },
        { role: "test", files: 1, changes: 20 },
        { role: "dependency", files: 1, changes: 5 },
      ]),
    );
    expect(
      ctx.fileRoleSummary.find((r) => r.role === "generated"),
    ).toBeUndefined();
  });

  it("borne les labels envoyés au LLM tout en gardant les labels d'intention", () => {
    const data = baseData([]);
    data.repositoryLabels = [
      ...Array.from({ length: 100 }, (_, index) => `area/${index}`),
      "kind/bug",
    ];

    const ctx = buildPullRequestLlmContext(data);

    expect(ctx.repositoryLabels).toHaveLength(MAX_REPOSITORY_LABELS_FOR_LLM);
    expect(ctx.repositoryLabels).toContain("kind/bug");
  });
});

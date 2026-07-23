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

  it("inclut score et ignored dans allFilesSummary", () => {
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
      expect(summary).toHaveProperty("ignored");
    }
  });

  it("exclut les fichiers ignorés des selectedFiles", () => {
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
          filename: "dist/bundle.js",
          status: "modified",
          additions: 1,
          deletions: 0,
          changes: 1,
        },
      ]),
    );
    const names = ctx.selectedFiles.map((r) => r.file.filename);
    expect(names).toContain("src/a.ts");
    expect(names).not.toContain("dist/bundle.js");
    expect(ctx.ignoredFilesCount).toBe(1);
  });

  it("limite selectedFiles à MAX_FILES_FOR_LLM", () => {
    const files: PullRequestFileData[] = Array.from({ length: 20 }, (_, i) => ({
      filename: `src/file${i}.ts`,
      status: "modified",
      additions: 1,
      deletions: 0,
      changes: 1,
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

  it("résume la distribution des rôles de fichiers", () => {
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
      ]),
    );

    expect(ctx.fileRoleSummary).toEqual(
      expect.arrayContaining([
        { role: "source", files: 1, changes: 10 },
        { role: "test", files: 1, changes: 20 },
      ]),
    );
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

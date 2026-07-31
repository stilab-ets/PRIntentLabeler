import { describe, it, expect } from "vitest";
import {
  admitFilesWithinPatchBudget,
  allocatePatchTokenBudgets,
  buildPullRequestLlmContext,
} from "../src/llm/pr-context.js";
import type {
  PullRequestData,
  PullRequestFileData,
  RankedPullRequestFile,
} from "../src/domain/pull-request-data.js";
import {
  MAX_FILES_FOR_LLM,
  MAX_REPOSITORY_LABELS_FOR_LLM,
  MAX_TOTAL_PATCH_CHARS,
  MAX_TOTAL_PATCH_TOKENS,
  MIN_PATCH_TOKENS_PER_FILE,
} from "../src/utils/constants.js";
import { estimateTokens } from "../src/llm/patch-utils.js";
import { resolveLlmTokenBudget } from "../src/llm/model-budget.js";

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

  it("plafonne selectedFiles à MAX_FILES_FOR_LLM même avec un gros budget", () => {
    const files: PullRequestFileData[] = Array.from({ length: 40 }, (_, i) => ({
      filename: `src/file${i}.ts`,
      status: "modified",
      additions: 1,
      deletions: 0,
      changes: 1,
      patch: `+line${i}`,
    }));
    const ctx = buildPullRequestLlmContext(baseData(files), {
      tokenBudget: resolveLlmTokenBudget("gemini", "gemini-3.5-flash"),
    });
    expect(ctx.selectedFiles.length).toBe(MAX_FILES_FOR_LLM);
    expect(ctx.selectedFilesCount).toBe(MAX_FILES_FOR_LLM);
  });

  it("envoie plus de 6 petits fichiers quand le modèle a la place", () => {
    const files: PullRequestFileData[] = Array.from({ length: 12 }, (_, i) => ({
      filename: `src/file${i}.ts`,
      status: "modified",
      additions: 1,
      deletions: 0,
      changes: 1,
      patch: `+line${i}`,
    }));
    const ctx = buildPullRequestLlmContext(baseData(files), {
      tokenBudget: resolveLlmTokenBudget("gemini", "gemini-3.5-flash"),
    });
    expect(ctx.selectedFiles.length).toBeGreaterThan(6);
    expect(ctx.selectedFiles.length).toBe(12);
  });

  it("réduit le nombre de fichiers quand le budget de patchs est trop petit", () => {
    const files: PullRequestFileData[] = Array.from({ length: 10 }, (_, i) => ({
      filename: `src/file${i}.ts`,
      status: "modified",
      additions: 100,
      deletions: 0,
      changes: 100,
      patch: `+${"x".repeat(3_000)}`,
    }));
    const ctx = buildPullRequestLlmContext(baseData(files), {
      tokenBudget: {
        contextWindowTokens: 8_000,
        responseReserveTokens: 2_000,
        promptTokenBudget: 4_000,
        source: "environment",
      },
    });
    expect(ctx.selectedFiles.length).toBeGreaterThan(0);
    expect(ctx.selectedFiles.length).toBeLessThan(10);
    expect(ctx.promptBudget.availablePatchTokens).toBeLessThanOrEqual(
      MAX_TOTAL_PATCH_TOKENS,
    );
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

  it("respecte la limite du prompt complet avec la réserve de réponse du modèle", () => {
    const files: PullRequestFileData[] = Array.from({ length: 6 }, (_, i) => ({
      filename: `src/file${i}.ts`,
      status: "modified",
      additions: 100,
      deletions: 0,
      changes: 100,
      patch: `+${"x".repeat(20_000)}`,
    }));

    const tokenBudget = resolveLlmTokenBudget("custom", "");
    const ctx = buildPullRequestLlmContext(baseData(files), { tokenBudget });
    expect(
      ctx.promptBudget.finalPromptEstimatedTokens +
        ctx.promptBudget.responseReserveTokens,
    ).toBeLessThanOrEqual(tokenBudget.contextWindowTokens);
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

  it("ramène un budget négatif à zéro", () => {
    expect(allocatePatchTokenBudgets([100, 200], -50)).toEqual([0, 0]);
  });

  it("redistribue le reliquat laissé par les petits fichiers", () => {
    expect(
      allocatePatchTokenBudgets([1_500, 20, 20, 20, 20, 20], 2_500, 1_500),
    ).toEqual([1_500, 20, 20, 20, 20, 20]);
  });

  it("conserve exactement le budget quand la demande totale est suffisante", () => {
    const allocations = allocatePatchTokenBudgets(
      [1_500, 1_000, 20, 20, 20, 20],
      2_500,
      1_500,
    );
    expect(allocations).toEqual([1_500, 920, 20, 20, 20, 20]);
    expect(allocations.reduce((sum, value) => sum + value, 0)).toBe(2_500);
  });
});

describe("admitFilesWithinPatchBudget", () => {
  function candidate(filename: string, patch: string): RankedPullRequestFile {
    return {
      file: {
        filename,
        status: "modified",
        additions: 1,
        deletions: 0,
        changes: 1,
        patch,
      },
      score: 10,
      reasons: [],
      role: "source",
      contentPolicy: "include-patch",
    };
  }

  it("garde le premier fichier même si le budget est très serré", () => {
    const admitted = admitFilesWithinPatchBudget(
      [candidate("a.ts", `+${"x".repeat(3_000)}`)],
      50,
    );
    expect(admitted.map((file) => file.file.filename)).toEqual(["a.ts"]);
  });

  it("refuse un fichier supplémentaire sans extrait lisible", () => {
    const big = `+${"x".repeat(3_000)}`;
    const admitted = admitFilesWithinPatchBudget(
      [candidate("a.ts", big), candidate("b.ts", big), candidate("c.ts", big)],
      MIN_PATCH_TOKENS_PER_FILE + 10,
    );
    expect(admitted).toHaveLength(1);
  });

  it("admet plusieurs petits fichiers tant que le budget le permet", () => {
    const admitted = admitFilesWithinPatchBudget(
      Array.from({ length: 8 }, (_, i) => candidate(`f${i}.ts`, "+ok")),
      1_000,
    );
    expect(admitted).toHaveLength(8);
  });
});

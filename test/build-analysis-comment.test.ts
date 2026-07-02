import { describe, it, expect } from "vitest";
import { buildAnalysisComment } from "../src/comments/build-analysis-comment.js";
import { buildPullRequestLlmContext } from "../src/llm/pr-context.js";
import type { PullRequestData } from "../src/domain/pull-request-data.js";
import type { PullRequestAnalysis } from "../src/domain/llm-analysis.js";
import { BOT_COMMENT_MARKER } from "../src/utils/constants.js";

const baseData: PullRequestData = {
  owner: "org",
  repo: "test-repo",
  number: 42,
  title: "Fix login bug",
  body: "",
  author: "mehdi",
  baseBranch: "main",
  headBranch: "fix-login",
  htmlUrl: "https://github.com/org/test-repo/pull/42",
  additions: 25,
  deletions: 5,
  changedFilesCount: 2,
  files: [
    {
      filename: "src/auth/login.ts",
      status: "modified",
      additions: 20,
      deletions: 5,
      changes: 25,
    },
    {
      filename: "test/auth/login.test.ts",
      status: "added",
      additions: 5,
      deletions: 0,
      changes: 5,
    },
  ],
  repositoryLabels: ["bug", "feature", "tests"],
  pullRequestLabels: [],
};

function contextFor(data: PullRequestData) {
  return buildPullRequestLlmContext(data);
}

describe("buildAnalysisComment", () => {
  it("inclut le marker pour permettre l'upsert", () => {
    const result = buildAnalysisComment(baseData, contextFor(baseData));
    expect(result.startsWith(BOT_COMMENT_MARKER)).toBe(true);
  });

  it("affiche les infos de la PR dans le tableau", () => {
    const result = buildAnalysisComment(baseData, contextFor(baseData));
    expect(result).toContain("#42");
    expect(result).toContain("Fix login bug");
    expect(result).toContain("mehdi");
    expect(result).toContain("+25 / -5");
  });

  it("liste les fichiers sélectionnés pour l'analyse", () => {
    const result = buildAnalysisComment(baseData, contextFor(baseData));
    expect(result).toContain("`src/auth/login.ts`");
    expect(result).toContain("`test/auth/login.test.ts`");
  });

  it("escape les caractères pipe dans le titre", () => {
    const data = { ...baseData, title: "Fix bug | edge case" };
    const result = buildAnalysisComment(data, contextFor(data));
    expect(result).toContain("Fix bug \\| edge case");
  });

  it("affiche les labels disponibles si aucune analyse LLM", () => {
    const data = { ...baseData, repositoryLabels: [] };
    const result = buildAnalysisComment(data, contextFor(data));
    expect(result).toContain("Aucun label trouvé");
  });

  it("affiche le nombre de fichiers analysés et ignorés", () => {
    const result = buildAnalysisComment(baseData, contextFor(baseData));
    expect(result).toContain("Fichiers analysés par le LLM");
    expect(result).toContain("Fichiers ignorés");
  });

  it("affiche les labels suggérés sous forme de cases à cocher et le résumé quand l'analyse est fournie", () => {
    const analysis: PullRequestAnalysis = {
      suggestions: [{ name: "bug", confidence: 0.9, reason: "corrige un crash" }],
      summary: "Correction d'un bug d'authentification.",
    };
    const result = buildAnalysisComment(baseData, contextFor(baseData), analysis);
    expect(result).toContain("Labels suggérés — coche ceux à appliquer");
    expect(result).toContain("- [ ] `bug`");
    expect(result).toContain("90%");
    expect(result).toContain("Correction d'un bug d'authentification.");
  });

  it("affiche les cases à cocher même quand aucun label n'est encore appliqué", () => {
    const analysis: PullRequestAnalysis = {
      suggestions: [{ name: "bug", confidence: 0.9, reason: "corrige un crash" }],
      summary: "",
    };
    const result = buildAnalysisComment(baseData, contextFor(baseData), analysis, []);
    expect(result).toContain("- [ ] `bug`");
    expect(result).toContain("Aucun label appliqué pour l'instant.");
  });

  it("précoche les cases des labels déjà appliqués", () => {
    const analysis: PullRequestAnalysis = {
      suggestions: [
        { name: "bug", confidence: 0.9, reason: "corrige un crash" },
        { name: "feature", confidence: 0.6, reason: "ajoute une fonctionnalité" },
      ],
      summary: "",
    };
    const result = buildAnalysisComment(
      baseData,
      contextFor(baseData),
      analysis,
      ["bug"],
    );
    expect(result).toContain("- [x] `bug`");
    expect(result).toContain("- [ ] `feature`");
    expect(result).toContain("1 label(s) actuellement appliqué(s) : `bug`.");
  });
});

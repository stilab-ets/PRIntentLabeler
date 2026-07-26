import type {
  PullRequestData,
  PullRequestLlmContext,
  FileRoleSummary,
  RankedFileSummary,
  RankedPullRequestFile,
} from "../domain/pull-request-data.js";
import {
  ESTIMATED_CHARS_PER_TOKEN,
  LLM_RESPONSE_TOKEN_RESERVE,
  MAX_ALL_FILES_SUMMARY,
  MAX_FILES_FOR_LLM,
  MAX_LLM_CONTEXT_TOKENS,
  MAX_PATCH_TOKENS_PER_FILE,
  MAX_REPOSITORY_LABELS_FOR_LLM,
  MAX_TOTAL_PATCH_TOKENS,
} from "../utils/constants.js";
import {
  inferPreferredFileRoles,
  rankFilesByImportance,
  selectRepresentativeFiles,
} from "./file-selector.js";
import { estimateTokens, truncateFilePatch } from "./patch-utils.js";
import {
  buildClassificationPromptWithoutPatches,
  buildClassificationSystemPrompt,
} from "./prompt-builder.js";
import { selectCandidateLabels } from "./label-selector.js";

function buildFileRoleSummary(
  ranked: RankedPullRequestFile[],
): FileRoleSummary[] {
  const roleTotals = new Map<
    RankedPullRequestFile["role"],
    { files: number; changes: number }
  >();

  for (const rankedFile of ranked) {
    // Le bruit généré/binaire n'apporte aucun signal utile ; en revanche un
    // lockfile (dependency) ou un snapshot (test) "summary-only" reste compté
    // ici, car il révèle bien une intention (ex. "cette PR touche aux deps").
    if (rankedFile.role === "generated") continue;

    const current = roleTotals.get(rankedFile.role) ?? { files: 0, changes: 0 };
    current.files += 1;
    current.changes += rankedFile.file.changes;
    roleTotals.set(rankedFile.role, current);
  }

  return [...roleTotals.entries()]
    .map(([role, totals]) => ({ role, ...totals }))
    .sort((a, b) => b.changes - a.changes || b.files - a.files);
}

// Budget réel disponible pour les patches : dérivé du budget total du prompt
// moins tout ce qui n'est pas un patch (system prompt, métadonnées, labels,
// résumés de fichiers...) et la réserve pour la réponse du LLM. On rend le
// prompt réel "sans patches" pour l'estimer, au lieu de dupliquer sa structure.
function computeAvailablePatchTokens(
  contextWithoutPatches: PullRequestLlmContext,
): number {
  const systemPrompt = buildClassificationSystemPrompt();
  const userPromptWithoutPatches = buildClassificationPromptWithoutPatches(
    contextWithoutPatches,
  );
  const nonPatchTokens =
    estimateTokens(systemPrompt) + estimateTokens(userPromptWithoutPatches);

  const budget =
    MAX_LLM_CONTEXT_TOKENS - LLM_RESPONSE_TOKEN_RESERVE - nonPatchTokens;

  return Math.max(0, Math.min(MAX_TOTAL_PATCH_TOKENS, budget));
}

export function buildPullRequestLlmContext(
  prData: PullRequestData,
): PullRequestLlmContext {
  const ranked = rankFilesByImportance(prData.files, {
    title: prData.title,
    body: prData.body,
  });

  const summaryOnlyFilesCount = ranked.filter(
    (r) => r.contentPolicy === "summary-only",
  ).length;

  const representativeFiles = selectRepresentativeFiles(
    ranked,
    MAX_FILES_FOR_LLM,
    inferPreferredFileRoles(prData.title),
  );

  // Résumé global : tous les fichiers (sans patch), limité pour rester compact.
  const allFilesSummary: RankedFileSummary[] = ranked
    .slice(0, MAX_ALL_FILES_SUMMARY)
    .map((r) => ({
      filename: r.file.filename,
      status: r.file.status,
      additions: r.file.additions,
      deletions: r.file.deletions,
      changes: r.file.changes,
      score: r.score,
      role: r.role,
      contentPolicy: r.contentPolicy,
    }));

  const fileRoleSummary = buildFileRoleSummary(ranked);

  const repositoryLabelDescriptions = prData.repositoryLabelDescriptions ?? {};
  const repositoryLabels = selectCandidateLabels(
    prData.repositoryLabels,
    repositoryLabelDescriptions,
    MAX_REPOSITORY_LABELS_FOR_LLM,
  );

  const contextWithoutPatches: PullRequestLlmContext = {
    repository: {
      owner: prData.owner,
      repo: prData.repo,
    },
    pullRequest: {
      number: prData.number,
      title: prData.title,
      body: prData.body,
      author: prData.author,
      baseBranch: prData.baseBranch,
      headBranch: prData.headBranch,
      htmlUrl: prData.htmlUrl,
    },
    totals: {
      additions: prData.additions,
      deletions: prData.deletions,
      changedFilesCount: prData.changedFilesCount,
    },
    repositoryLabels,
    repositoryLabelDescriptions,
    allFilesSummary,
    fileRoleSummary,
    selectedFiles: representativeFiles.map((r) => ({
      ...r,
      file: { ...r.file, patch: undefined },
    })),
    summaryOnlyFilesCount,
    omittedFilesCount: Math.max(0, ranked.length - allFilesSummary.length),
    selectedFilesCount: representativeFiles.length,
  };

  const availablePatchTokens = computeAvailablePatchTokens(contextWithoutPatches);

  // Budget partagé : le plafond global protège le TPM, tandis que le plafond
  // par fichier empêche un seul diff d'écraser les autres exemples.
  let remainingPatchTokens = availablePatchTokens;
  const selectedFiles: RankedPullRequestFile[] = representativeFiles.map(
    (rankedFile, index) => {
      const remainingFiles = representativeFiles.length - index;
      const fairShare = Math.floor(remainingPatchTokens / remainingFiles);
      const tokenBudget = Math.min(MAX_PATCH_TOKENS_PER_FILE, fairShare);
      const charBudget = tokenBudget * ESTIMATED_CHARS_PER_TOKEN;
      const file = truncateFilePatch(rankedFile.file, undefined, charBudget);
      remainingPatchTokens -= estimateTokens(file.patch);
      return { ...rankedFile, file };
    },
  );

  return { ...contextWithoutPatches, selectedFiles };
}

import type {
  PullRequestData,
  PullRequestLlmContext,
  FileRoleSummary,
  RankedFileSummary,
  RankedPullRequestFile,
} from "../domain/pull-request-data.js";
import {
  MAX_ALL_FILES_SUMMARY,
  MAX_FILES_FOR_LLM,
  ESTIMATED_CHARS_PER_TOKEN,
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
import { selectCandidateLabels } from "./label-selector.js";

export function buildPullRequestLlmContext(
  prData: PullRequestData,
): PullRequestLlmContext {
  const ranked = rankFilesByImportance(prData.files);

  const ignoredFilesCount = ranked.filter((r) => r.ignored).length;

  const representativeFiles = selectRepresentativeFiles(
    ranked,
    MAX_FILES_FOR_LLM,
    inferPreferredFileRoles(prData.title),
  );

  // Budget partagé : le plafond global protège le TPM, tandis que le plafond
  // par fichier empêche un seul diff d'écraser les autres exemples.
  let remainingPatchTokens = MAX_TOTAL_PATCH_TOKENS;
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
      ignored: r.ignored,
      role: r.role,
    }));

  const roleTotals = new Map<
    RankedPullRequestFile["role"],
    { files: number; changes: number }
  >();
  for (const rankedFile of ranked) {
    if (rankedFile.ignored) continue;
    const current = roleTotals.get(rankedFile.role) ?? { files: 0, changes: 0 };
    current.files += 1;
    current.changes += rankedFile.file.changes;
    roleTotals.set(rankedFile.role, current);
  }

  const fileRoleSummary: FileRoleSummary[] = [...roleTotals.entries()]
    .map(([role, totals]) => ({ role, ...totals }))
    .sort((a, b) => b.changes - a.changes || b.files - a.files);

  const repositoryLabelDescriptions = prData.repositoryLabelDescriptions ?? {};
  const repositoryLabels = selectCandidateLabels(
    prData.repositoryLabels,
    repositoryLabelDescriptions,
    MAX_REPOSITORY_LABELS_FOR_LLM,
  );

  return {
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
    selectedFiles,
    ignoredFilesCount,
    omittedFilesCount: Math.max(0, ranked.length - allFilesSummary.length),
    selectedFilesCount: selectedFiles.length,
  };
}

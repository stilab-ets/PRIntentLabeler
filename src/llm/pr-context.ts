import type {
  FileRoleSummary,
  PullRequestData,
  PullRequestLlmContext,
  RankedFileSummary,
  RankedPullRequestFile,
} from "../domain/pull-request-data.js";
import {
  ESTIMATED_CHARS_PER_TOKEN,
  LLM_RESPONSE_TOKEN_RESERVE,
  MAX_ALL_FILES_SUMMARY,
  MAX_FILES_FOR_LLM,
  MAX_LLM_CONTEXT_TOKENS,
  MAX_PATCH_LINES_PER_FILE,
  MAX_PATCH_TOKENS_PER_FILE,
  MAX_REPOSITORY_LABELS_FOR_LLM,
  MAX_TOTAL_PATCH_TOKENS,
} from "../utils/constants.js";
import {
  inferPreferredFileRoles,
  rankFilesByImportance,
  selectRepresentativeFiles,
} from "./file-selector.js";
import { estimateTokens, truncatePatch } from "./patch-utils.js";
import {
  buildClassificationPrompt,
  buildClassificationPromptWithoutPatches,
  buildClassificationSystemPrompt,
} from "./prompt-builder.js";
import { selectCandidateLabels } from "./label-selector.js";

type BuildContextOptions = {
  representativeFiles?: RankedPullRequestFile[];
};

function buildFileRoleSummary(
  ranked: RankedPullRequestFile[],
): FileRoleSummary[] {
  const roleTotals = new Map<
    RankedPullRequestFile["role"],
    { files: number; changes: number }
  >();

  for (const rankedFile of ranked) {
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

export function allocatePatchTokenBudgets(
  naturalTokenDemands: number[],
  totalBudget: number,
  perFileLimit: number = MAX_PATCH_TOKENS_PER_FILE,
): number[] {
  if (naturalTokenDemands.length === 0) return [];

  const safeBudget = Math.max(0, Math.floor(totalBudget));
  const cappedDemands = naturalTokenDemands.map((demand) =>
    Math.max(0, Math.min(Math.ceil(demand), perFileLimit)),
  );
  const fairShare = Math.floor(safeBudget / naturalTokenDemands.length);
  const allocations = cappedDemands.map((demand) =>
    Math.min(demand, fairShare),
  );

  let remaining =
    safeBudget - allocations.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < allocations.length && remaining > 0; index += 1) {
    const unmetDemand = cappedDemands[index] - allocations[index];
    const extra = Math.min(unmetDemand, remaining);
    allocations[index] += extra;
    remaining -= extra;
  }

  return allocations;
}

function estimateNonPatchTokens(context: PullRequestLlmContext): number {
  return (
    estimateTokens(buildClassificationSystemPrompt()) +
    estimateTokens(buildClassificationPromptWithoutPatches(context))
  );
}

function availablePatchTokens(nonPatchTokens: number): number {
  return Math.max(
    0,
    Math.min(
      MAX_TOTAL_PATCH_TOKENS,
      MAX_LLM_CONTEXT_TOKENS - LLM_RESPONSE_TOKEN_RESERVE - nonPatchTokens,
    ),
  );
}

function emptyPromptBudget(): PullRequestLlmContext["promptBudget"] {
  return {
    contextLimitTokens: MAX_LLM_CONTEXT_TOKENS,
    responseReserveTokens: LLM_RESPONSE_TOKEN_RESERVE,
    nonPatchEstimatedTokens: 0,
    availablePatchTokens: 0,
    allocatedPatchTokens: 0,
    finalPromptEstimatedTokens: 0,
    files: [],
  };
}

export function buildPullRequestLlmContext(
  prData: PullRequestData,
  options: BuildContextOptions = {},
): PullRequestLlmContext {
  const ranked = rankFilesByImportance(prData.files, {
    title: prData.title,
    body: prData.body,
  });

  const representativeFiles = (
    options.representativeFiles ??
    selectRepresentativeFiles(
      ranked,
      MAX_FILES_FOR_LLM,
      inferPreferredFileRoles(prData.title),
    )
  ).slice(0, MAX_FILES_FOR_LLM);

  const allFilesSummary: RankedFileSummary[] = ranked
    .slice(0, MAX_ALL_FILES_SUMMARY)
    .map((rankedFile) => ({
      filename: rankedFile.file.filename,
      status: rankedFile.file.status,
      additions: rankedFile.file.additions,
      deletions: rankedFile.file.deletions,
      changes: rankedFile.file.changes,
      score: rankedFile.score,
      role: rankedFile.role,
      contentPolicy: rankedFile.contentPolicy,
      contentReason: rankedFile.contentReason,
    }));

  const repositoryLabelDescriptions = prData.repositoryLabelDescriptions ?? {};
  const repositoryLabels = selectCandidateLabels(
    prData.repositoryLabels,
    repositoryLabelDescriptions,
    MAX_REPOSITORY_LABELS_FOR_LLM,
  );

  const contextWithoutPatches: PullRequestLlmContext = {
    repository: { owner: prData.owner, repo: prData.repo },
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
    fileRoleSummary: buildFileRoleSummary(ranked),
    selectedFiles: representativeFiles.map((rankedFile) => ({
      ...rankedFile,
      file: { ...rankedFile.file, patch: "" },
    })),
    summaryOnlyFilesCount: ranked.filter(
      (rankedFile) => rankedFile.contentPolicy === "summary-only",
    ).length,
    omittedFilesCount: Math.max(0, ranked.length - allFilesSummary.length),
    selectedFilesCount: representativeFiles.length,
    promptBudget: emptyPromptBudget(),
  };

  const nonPatchEstimatedTokens = estimateNonPatchTokens(contextWithoutPatches);
  const patchBudget = availablePatchTokens(nonPatchEstimatedTokens);
  const lineLimitedPatches = representativeFiles.map((rankedFile) =>
    truncatePatch(
      rankedFile.file.patch,
      MAX_PATCH_LINES_PER_FILE,
      Number.MAX_SAFE_INTEGER,
    ),
  );
  const naturalTokenDemands = lineLimitedPatches.map((patch) =>
    estimateTokens(patch),
  );
  const allocations = allocatePatchTokenBudgets(
    naturalTokenDemands,
    patchBudget,
  );

  const selectedFiles = representativeFiles.map((rankedFile, index) => {
    const sourcePatch = lineLimitedPatches[index] ?? "";
    const patch = truncatePatch(
      sourcePatch,
      Number.MAX_SAFE_INTEGER,
      allocations[index] * ESTIMATED_CHARS_PER_TOKEN,
    );

    return {
      ...rankedFile,
      file: { ...rankedFile.file, patch },
    };
  });

  const allocationFiles = selectedFiles.map((rankedFile, index) => {
    const actualTokens = estimateTokens(rankedFile.file.patch);
    return {
      filename: rankedFile.file.filename,
      naturalTokens: naturalTokenDemands[index],
      allocatedTokens: allocations[index],
      actualTokens,
      truncated:
        rankedFile.file.patch !== representativeFiles[index].file.patch,
    };
  });

  const context: PullRequestLlmContext = {
    ...contextWithoutPatches,
    selectedFiles,
    promptBudget: {
      contextLimitTokens: MAX_LLM_CONTEXT_TOKENS,
      responseReserveTokens: LLM_RESPONSE_TOKEN_RESERVE,
      nonPatchEstimatedTokens,
      availablePatchTokens: patchBudget,
      allocatedPatchTokens: allocationFiles.reduce(
        (sum, file) => sum + file.actualTokens,
        0,
      ),
      finalPromptEstimatedTokens: 0,
      files: allocationFiles,
    },
  };

  context.promptBudget.finalPromptEstimatedTokens =
    estimateTokens(buildClassificationSystemPrompt()) +
    estimateTokens(buildClassificationPrompt(context));

  return context;
}

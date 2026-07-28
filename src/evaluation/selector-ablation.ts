import type {
  PullRequestData,
  RankedPullRequestFile,
} from "../domain/pull-request-data.js";
import { rankFilesByImportance } from "../llm/file-selector.js";
import { buildPullRequestLlmContext } from "../llm/pr-context.js";
import type { PullRequestLlmContext } from "../domain/pull-request-data.js";
import { MAX_FILES_FOR_LLM } from "../utils/constants.js";

export type AblationVariant =
  | "A-title"
  | "B-title-roles"
  | "C-scored-diffs"
  | "D-random-diffs";

export type SetMetrics = {
  exactSetAccuracy: number;
  precision: number;
  recall: number;
  f1: number;
  jaccard: number;
};

function normalizedSet(labels: string[]): Set<string> {
  return new Set(
    labels.map((label) => label.trim().toLowerCase()).filter(Boolean),
  );
}

export function calculateSetMetrics(
  expected: string[],
  predicted: string[],
): SetMetrics {
  const expectedSet = normalizedSet(expected);
  const predictedSet = normalizedSet(predicted);
  const truePositives = [...predictedSet].filter((label) =>
    expectedSet.has(label),
  ).length;
  const union = new Set([...expectedSet, ...predictedSet]).size;
  const precision =
    predictedSet.size === 0
      ? expectedSet.size === 0
        ? 1
        : 0
      : truePositives / predictedSet.size;
  const recall =
    expectedSet.size === 0
      ? predictedSet.size === 0
        ? 1
        : 0
      : truePositives / expectedSet.size;

  return {
    exactSetAccuracy:
      expectedSet.size === predictedSet.size &&
      [...expectedSet].every((label) => predictedSet.has(label))
        ? 1
        : 0,
    precision,
    recall,
    f1:
      precision + recall === 0
        ? 0
        : (2 * precision * recall) / (precision + recall),
    jaccard: union === 0 ? 1 : truePositives / union,
  };
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function selectRandomRepresentativeFiles(
  rankedFiles: RankedPullRequestFile[],
  limit: number,
  seed: number,
): RankedPullRequestFile[] {
  const eligible = rankedFiles.filter(
    (rankedFile) =>
      rankedFile.contentPolicy === "include-patch" &&
      typeof rankedFile.file.patch === "string" &&
      rankedFile.file.patch.trim().length > 0,
  );
  const random = createSeededRandom(seed);

  for (let index = eligible.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [eligible[index], eligible[target]] = [eligible[target], eligible[index]];
  }

  return eligible.slice(0, Math.max(0, limit));
}

export function buildAblationContexts(
  prData: PullRequestData,
  seed: number,
): Record<AblationVariant, PullRequestLlmContext> {
  const ranked = rankFilesByImportance(prData.files, {
    title: prData.title,
    body: prData.body,
  });
  const scored = buildPullRequestLlmContext(prData);
  const randomSelection = selectRandomRepresentativeFiles(
    ranked,
    MAX_FILES_FOR_LLM,
    seed,
  );
  const random = buildPullRequestLlmContext(prData, {
    representativeFiles: randomSelection,
  });
  const withoutDiffs = {
    ...scored,
    selectedFiles: [],
    selectedFilesCount: 0,
  };

  return {
    "A-title": withoutDiffs,
    "B-title-roles": withoutDiffs,
    "C-scored-diffs": scored,
    "D-random-diffs": random,
  };
}

import type { PullRequestFileData } from "../domain/pull-request-data.js";
import {
  ESTIMATED_CHARS_PER_TOKEN,
  MAX_PATCH_CHARS_PER_FILE,
  MAX_PATCH_LINES_PER_FILE,
} from "../utils/constants.js";

export function estimateTokens(text: string | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / ESTIMATED_CHARS_PER_TOKEN);
}

function truncateByCharacters(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const marker = `\n... (${text.length - maxChars} characters truncated) ...\n`;
  if (marker.length >= maxChars) return text.slice(0, Math.max(0, maxChars));

  const available = Math.max(0, maxChars - marker.length);
  const headLength = Math.ceil(available * 0.7);
  const tailLength = available - headLength;
  const tail = tailLength > 0 ? text.slice(-tailLength) : "";

  return `${text.slice(0, headLength)}${marker}${tail}`;
}

// Repli historique tête/queue, utilisé quand le patch ne contient aucun
// header de hunk Git détectable (format non standard).
function truncateByLinesHeadTail(lines: string[], maxLines: number): string {
  if (lines.length <= maxLines) return lines.join("\n");

  const headCount = Math.ceil(maxLines * 0.7);
  const tailCount = Math.max(1, maxLines - headCount);
  const remaining = lines.length - headCount - tailCount;
  const marker = `... (${remaining} more lines truncated) ...`;

  return [
    ...lines.slice(0, headCount),
    marker,
    ...lines.slice(-tailCount),
  ].join("\n");
}

const HUNK_HEADER_REGEX = /^@@ .*@@/;
// Nombre de lignes de contexte conservées avant/après chaque ligne changée.
const CONTEXT_LINES_AROUND_CHANGE = 2;

type Hunk = { header: string; lines: string[] };

function isChangedLine(line: string): boolean {
  return (
    (line.startsWith("+") && !line.startsWith("+++")) ||
    (line.startsWith("-") && !line.startsWith("---"))
  );
}

function splitIntoHunks(patch: string): { preamble: string[]; hunks: Hunk[] } {
  const lines = patch.split("\n");
  const preamble: string[] = [];
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;

  for (const line of lines) {
    if (HUNK_HEADER_REGEX.test(line)) {
      current = { header: line, lines: [] };
      hunks.push(current);
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  }

  return { preamble, hunks };
}

/**
 * Ne garde, dans un hunk, que les lignes réellement changées (+/-) et une
 * petite fenêtre de contexte autour de chacune. Les lignes de contexte trop
 * éloignées d'un changement sont retirées et remplacées par un marqueur.
 * Les lignes changées elles-mêmes ne sont jamais sacrifiées ici : c'est le
 * budget global (voir redistributeAcrossHunks) qui arbitre en dernier ressort.
 */
function compactHunkLines(lines: string[]): string[] {
  const changeIndexes: number[] = [];
  lines.forEach((line, index) => {
    if (isChangedLine(line)) changeIndexes.push(index);
  });

  if (changeIndexes.length === 0) return lines;

  const keep = new Set<number>();
  for (const index of changeIndexes) {
    for (
      let i = Math.max(0, index - CONTEXT_LINES_AROUND_CHANGE);
      i <= Math.min(lines.length - 1, index + CONTEXT_LINES_AROUND_CHANGE);
      i += 1
    ) {
      keep.add(i);
    }
  }

  const sorted = [...keep].sort((a, b) => a - b);
  const kept: string[] = [];
  let previous = -2;
  for (const index of sorted) {
    if (index !== previous + 1 && kept.length > 0) {
      kept.push("... (context omitted) ...");
    }
    kept.push(lines[index]);
    previous = index;
  }

  return kept;
}

/**
 * Répartit le budget entre les hunks et priorise leurs lignes modifiées.
 */
function redistributeAcrossHunks(
  _preamble: string[],
  hunks: Hunk[],
  maxLines: number,
): string[] {
  if (maxLines <= 0 || hunks.length === 0) return [];

  const markerBudget = maxLines >= 4 ? 1 : 0;
  const contentBudget = maxLines - markerBudget;
  const maxRepresentedHunks = Math.max(
    1,
    Math.min(hunks.length, Math.floor(contentBudget / 2) || 1),
  );
  const selectedIndexes =
    maxRepresentedHunks === 1
      ? [0]
      : Array.from({ length: maxRepresentedHunks }, (_, index) =>
          Math.round((index * (hunks.length - 1)) / (maxRepresentedHunks - 1)),
        );
  const selected = selectedIndexes.map((index) => hunks[index]);
  const chosenLineIndexes = selected.map(() => new Set<number>());
  const candidates = selected.map((hunk) => [
    ...hunk.lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => isChangedLine(line))
      .map(({ index }) => index),
    ...hunk.lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => !isChangedLine(line))
      .map(({ index }) => index),
  ]);

  let remaining = Math.max(0, contentBudget - selected.length);
  let cursor = 0;
  while (
    remaining > 0 &&
    candidates.some((candidate) => candidate.length > 0)
  ) {
    const candidate = candidates[cursor % candidates.length];
    const next = candidate.shift();
    if (next !== undefined) {
      chosenLineIndexes[cursor % candidates.length].add(next);
      remaining -= 1;
    }
    cursor += 1;
  }

  const result: string[] = [];
  selected.forEach((hunk, index) => {
    result.push(hunk.header);
    const chosen = chosenLineIndexes[index];
    hunk.lines.forEach((line, lineIndex) => {
      if (chosen.has(lineIndex)) result.push(line);
    });
  });

  if (markerBudget > 0) result.push("... (additional diff lines omitted) ...");
  return result.slice(0, maxLines);
}

// Troncature consciente des hunks Git, avec répartition déterministe.
function truncatePatchByHunks(patch: string, maxLines: number): string {
  const { preamble, hunks } = splitIntoHunks(patch);

  if (hunks.length === 0) {
    return truncateByLinesHeadTail(patch.split("\n"), maxLines);
  }

  const compacted: Hunk[] = hunks.map((hunk) => ({
    header: hunk.header,
    lines: compactHunkLines(hunk.lines),
  }));

  const naive: string[] = [...preamble];
  for (const hunk of compacted) {
    naive.push(hunk.header, ...hunk.lines);
  }

  if (naive.length <= maxLines) return naive.join("\n");

  return redistributeAcrossHunks(preamble, compacted, maxLines).join("\n");
}

export function truncatePatch(
  patch: string | undefined,
  maxLines: number,
  maxChars: number = MAX_PATCH_CHARS_PER_FILE,
): string | undefined {
  if (patch === undefined) return undefined;

  const lines = patch.split("\n");
  const result =
    lines.length > maxLines ? truncatePatchByHunks(patch, maxLines) : patch;

  return truncateByCharacters(result, maxChars);
}

export function truncateFilePatch(
  file: PullRequestFileData,
  maxLines: number = MAX_PATCH_LINES_PER_FILE,
  maxChars: number = MAX_PATCH_CHARS_PER_FILE,
): PullRequestFileData {
  return { ...file, patch: truncatePatch(file.patch, maxLines, maxChars) };
}

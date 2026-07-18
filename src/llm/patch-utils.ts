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

export function truncatePatch(
  patch: string | undefined,
  maxLines: number,
  maxChars: number = MAX_PATCH_CHARS_PER_FILE,
): string | undefined {
  if (patch === undefined) return undefined;

  const lines = patch.split("\n");
  let result = patch;

  if (lines.length > maxLines) {
    const headCount = Math.ceil(maxLines * 0.7);
    const tailCount = Math.max(1, maxLines - headCount);
    const remaining = lines.length - headCount - tailCount;
    const marker = `... (${remaining} more lines truncated) ...`;

    result = [
      ...lines.slice(0, headCount),
      marker,
      ...lines.slice(-tailCount),
    ].join("\n");
  }

  return truncateByCharacters(result, maxChars);
}

export function truncateFilePatch(
  file: PullRequestFileData,
  maxLines: number = MAX_PATCH_LINES_PER_FILE,
  maxChars: number = MAX_PATCH_CHARS_PER_FILE,
): PullRequestFileData {
  return { ...file, patch: truncatePatch(file.patch, maxLines, maxChars) };
}

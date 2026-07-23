import type { LabelSuggestion } from "../domain/label-suggestion.js";
import type { PullRequestAnalysis } from "../domain/llm-analysis.js";

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function normalizeSuggestions(raw: unknown): LabelSuggestion[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry): LabelSuggestion => {
      const suggestion = (entry ?? {}) as Record<string, unknown>;
      return {
        name: typeof suggestion.name === "string" ? suggestion.name.trim() : "",
        confidence:
          typeof suggestion.confidence === "number"
            ? clamp01(suggestion.confidence)
            : 0,
        reason:
          typeof suggestion.reason === "string" ? suggestion.reason.trim() : "",
      };
    })
    .filter((suggestion) => suggestion.name.length > 0);
}

function extractJsonObject(content: string): string {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end < start) return "{}";
  return trimmed.slice(start, end + 1);
}

export function parsePullRequestAnalysis(content: string): PullRequestAnalysis {
  let parsed: { suggestions?: unknown; summary?: unknown };
  try {
    parsed = JSON.parse(extractJsonObject(content)) as {
      suggestions?: unknown;
      summary?: unknown;
    };
  } catch {
    return { suggestions: [], summary: "" };
  }

  return {
    suggestions: normalizeSuggestions(parsed.suggestions),
    summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
  };
}

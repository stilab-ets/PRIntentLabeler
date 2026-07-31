import type { LabelSuggestion } from "../domain/label-suggestion.js";
import type { PullRequestAnalysis } from "../domain/llm-analysis.js";

export function normalizeSuggestions(raw: unknown): LabelSuggestion[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry): LabelSuggestion | null => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }

      const suggestion = entry as Record<string, unknown>;
      const name =
        typeof suggestion.name === "string" ? suggestion.name.trim() : "";
      const confidence = suggestion.confidence;

      // Le contrat exige un nombre dans [0, 1]. Une chaîne "0.9", NaN ou une
      // valeur hors intervalle est rejetée plutôt que convertie ou bornée :
      // sinon une sortie invalide pourrait gagner artificiellement en confiance.
      if (
        !name ||
        typeof confidence !== "number" ||
        !Number.isFinite(confidence) ||
        confidence < 0 ||
        confidence > 1
      ) {
        return null;
      }

      return {
        name,
        confidence,
        reason:
          typeof suggestion.reason === "string" ? suggestion.reason.trim() : "",
      };
    })
    .filter((suggestion): suggestion is LabelSuggestion => suggestion !== null);
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

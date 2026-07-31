import type { LabelSuggestion } from "../domain/label-suggestion.js";

export function filterValidSuggestions(
  suggestions: unknown,
  repositoryLabels: readonly string[],
  minConfidence = 0.7,
  maxLabels = 3,
): LabelSuggestion[] {
  if (!Array.isArray(suggestions)) return [];

  const canonicalLabels = new Map<string, string>();
  for (const label of repositoryLabels) {
    const key = label.toLowerCase();
    if (!canonicalLabels.has(key)) canonicalLabels.set(key, label);
  }

  const safeMinConfidence = Number.isFinite(minConfidence)
    ? minConfidence
    : 0.7;
  const safeMaxLabels = Number.isFinite(maxLabels)
    ? Math.max(0, Math.floor(maxLabels))
    : 3;
  const seen = new Set<string>();

  return (
    suggestions
      .map((candidate): LabelSuggestion | null => {
        if (
          !candidate ||
          typeof candidate !== "object" ||
          Array.isArray(candidate)
        ) {
          return null;
        }

        const suggestion = candidate as Record<string, unknown>;
        const name =
          typeof suggestion.name === "string" ? suggestion.name.trim() : "";
        const confidence = suggestion.confidence;

        if (
          !name ||
          typeof confidence !== "number" ||
          !Number.isFinite(confidence) ||
          confidence < safeMinConfidence ||
          confidence > 1
        ) {
          return null;
        }

        const canonicalName = canonicalLabels.get(name.toLowerCase());
        if (!canonicalName) return null;

        // On reconstruit l'objet au lieu de propager d'éventuelles propriétés
        // inattendues provenant d'un provider ou d'un test externe.
        return {
          name: canonicalName,
          confidence,
          reason:
            typeof suggestion.reason === "string"
              ? suggestion.reason.trim()
              : "",
        };
      })
      .filter(
        (suggestion): suggestion is LabelSuggestion => suggestion !== null,
      )
      // Le meilleur doublon doit gagner. Dédupliquer avant ce tri conserverait
      // parfois une suggestion à 0.71 au lieu de sa variante à 0.98.
      .sort((a, b) => b.confidence - a.confidence)
      .filter((suggestion) => {
        const key = suggestion.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, safeMaxLabels)
  );
}

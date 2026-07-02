import type { LabelSuggestion } from "../domain/label-suggestion.js";
import {
  AUTO_APPLY_CONFIDENCE_THRESHOLD,
  MAX_LABELS_TO_APPLY,
} from "../utils/constants.js";
import { stripAiLabelName } from "./ai-label-name.js";

// Modes d'application des labels après analyse LLM.
// - suggest   : ne touche pas aux labels, publie seulement un commentaire.
// - auto-high : applique les labels au-dessus du seuil de confiance.
// - auto-all  : applique tous les labels retenus (top N par confiance).
export type LabelMode = "suggest" | "auto-high" | "auto-all";

export const DEFAULT_LABEL_MODE: LabelMode = "suggest";

// Normalise la valeur de la variable d'environnement LABEL_MODE.
// Tout ce qui n'est pas reconnu retombe sur le mode sûr par défaut.
export function resolveLabelMode(raw: string | undefined): LabelMode {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "auto-high":
    case "auto_high":
    case "high":
      return "auto-high";
    case "auto-all":
    case "auto_all":
    case "all":
      return "auto-all";
    default:
      return DEFAULT_LABEL_MODE;
  }
}

// Sélectionne, parmi les suggestions déjà validées (triées par confiance
// décroissante), celles qui doivent être appliquées selon le mode.
export function selectLabelsToApply(
  suggestions: LabelSuggestion[],
  mode: LabelMode,
  autoApplyThreshold: number = AUTO_APPLY_CONFIDENCE_THRESHOLD,
  maxLabels: number = MAX_LABELS_TO_APPLY,
): LabelSuggestion[] {
  switch (mode) {
    case "suggest":
      return [];
    case "auto-high":
      return suggestions
        .filter((s) => s.confidence >= autoApplyThreshold)
        .slice(0, maxLabels);
    case "auto-all":
      return suggestions.slice(0, maxLabels);
  }
}

// Labels suggérés déjà présents sur la PR (sous leur forme "🤖 <nom>" ou,
// si posés manuellement, sous leur nom brut) mais sous le seuil auto-high :
// à retirer quand l'utilisateur bascule vers « Auto-apply high ». Le nom
// retourné est celui exact présent sur la PR, utilisable tel quel pour
// l'appel de suppression à l'API GitHub.
export function selectSuggestedLabelsBelowThreshold(
  suggestions: LabelSuggestion[],
  currentPrLabels: string[],
  threshold: number = AUTO_APPLY_CONFIDENCE_THRESHOLD,
): string[] {
  const confidenceByName = new Map(
    suggestions.map((s) => [s.name.toLowerCase(), s.confidence]),
  );

  return currentPrLabels.filter((label) => {
    const baseName = stripAiLabelName(label).toLowerCase();
    const confidence = confidenceByName.get(baseName);
    return confidence !== undefined && confidence < threshold;
  });
}

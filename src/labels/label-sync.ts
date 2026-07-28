import { isAiLabelName, stripAiLabelName } from "./ai-label-name.js";

// Calcule, à partir des labels suggérés, des labels cochés et des labels
// actuellement présents sur la PR, ceux à ajouter et ceux à retirer.
//
// Règle (symétrique, limitée au périmètre des labels suggérés) :
// - ajouter   : un label coché qui n'est pas encore sur la PR (nom brut,
//   la variante "🤖 <nom>" est créée/appliquée par l'appelant)
// - retirer   : un label suggéré NON coché qui est présent sur la PR
//   (on ne retire jamais un label hors de la liste suggérée, pour ne pas
//    toucher aux labels posés manuellement par un humain).
export function computeLabelChanges(
  suggested: string[],
  checked: string[],
  current: string[],
): { toAdd: string[]; toRemove: string[] } {
  const checkedSet = new Set(checked.map((l) => l.toLowerCase()));
  const suggestedSet = new Set(suggested.map((l) => l.toLowerCase()));
  const currentAiLabels = current.filter(isAiLabelName);
  const currentAiBaseNames = currentAiLabels.map((label) =>
    stripAiLabelName(label).toLowerCase(),
  );
  const currentSet = new Set(currentAiBaseNames);

  const toAdd = checked.filter((l) => !currentSet.has(l.toLowerCase()));

  const toRemove = currentAiLabels.filter((label, index) => {
    const baseName = currentAiBaseNames[index];
    return suggestedSet.has(baseName) && !checkedSet.has(baseName);
  });

  return { toAdd, toRemove };
}

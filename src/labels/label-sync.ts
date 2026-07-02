import { stripAiLabelName } from "./ai-label-name.js";

// Calcule, à partir des labels suggérés, des labels cochés et des labels
// actuellement présents sur la PR, ceux à ajouter et ceux à retirer.
//
// Règle (symétrique, limitée au périmètre des labels suggérés) :
// - ajouter   : un label coché qui n'est pas encore sur la PR (nom brut,
//   la variante "🤖 <nom>" est créée/appliquée par l'appelant)
// - retirer   : un label suggéré NON coché qui est présent sur la PR
//   (on ne retire jamais un label hors de la liste suggérée, pour ne pas
//    toucher aux labels posés manuellement par un humain). `current` peut
//    contenir la forme préfixée "🤖 <nom>" : on compare sur le nom de base
//    mais on retourne le nom exact tel qu'il apparaît sur la PR.
export function computeLabelChanges(
  suggested: string[],
  checked: string[],
  current: string[],
): { toAdd: string[]; toRemove: string[] } {
  const checkedSet = new Set(checked.map((l) => l.toLowerCase()));
  const suggestedSet = new Set(suggested.map((l) => l.toLowerCase()));
  const currentBaseNames = current.map((l) => stripAiLabelName(l).toLowerCase());
  const currentSet = new Set(currentBaseNames);

  const toAdd = checked.filter((l) => !currentSet.has(l.toLowerCase()));

  const toRemove = current.filter((l, i) => {
    const baseName = currentBaseNames[i];
    return suggestedSet.has(baseName) && !checkedSet.has(baseName);
  });

  return { toAdd, toRemove };
}

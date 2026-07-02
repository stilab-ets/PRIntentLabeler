import { AI_LABEL_PREFIX } from "../utils/constants.js";

// Un nom de label "IA" est simplement le nom d'origine préfixé par le robot.
// Ces trois fonctions sont le point unique de vérité pour cette conversion :
// tout le reste du code doit passer par elles plutôt que de manipuler le
// préfixe directement.
export function isAiLabelName(name: string): boolean {
  return name.startsWith(AI_LABEL_PREFIX);
}

export function toAiLabelName(name: string): string {
  return isAiLabelName(name) ? name : `${AI_LABEL_PREFIX}${name}`;
}

export function stripAiLabelName(name: string): string {
  return isAiLabelName(name) ? name.slice(AI_LABEL_PREFIX.length) : name;
}

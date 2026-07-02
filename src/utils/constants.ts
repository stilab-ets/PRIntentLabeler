export const BOT_COMMENT_MARKER = "<!-- llm-pr-labeler -->";
export const MAX_FILES_IN_COMMENT = 20;

// Nombre maximum de fichiers (les mieux scorés) dont le diff est envoyé au LLM.
// Valeur conservative pour respecter la limite TPM du tier gratuit Groq (6 000 tokens/min).
export const MAX_FILES_FOR_LLM = 6;

// Nombre maximum de lignes conservées par patch avant troncature.
export const MAX_PATCH_LINES_PER_FILE = 40;

// Taille maximale du résumé de tous les fichiers inclus dans le contexte.
export const MAX_ALL_FILES_SUMMARY = 100;

// --- Politique d'application des labels -----------------------------------

// Nombre maximum de labels retenus/appliqués sur une PR.
// Modifiable : changer cette valeur ajuste à la fois la suggestion et l'auto-apply.
export const MAX_LABELS_TO_APPLY = 3;

// Confiance minimale pour qu'un label soit proposé dans le commentaire.
export const MIN_CONFIDENCE_TO_SUGGEST = 0.7;

// Confiance minimale pour qu'un label soit appliqué automatiquement (mode auto-high).
export const AUTO_APPLY_CONFIDENCE_THRESHOLD = 0.85;

// --- Marqueur visuel "label posé par l'IA" --------------------------------
// GitHub ne permet pas d'ajouter une icône à côté d'un label existant sans
// toucher au nom du label lui-même. Quand un label suggéré par le LLM est
// appliqué (auto-apply ou case cochée), on crée/utilise donc une variante de
// ce label préfixée par ce robot, ex. "bug" -> "🤖 bug". Un label ajouté
// manuellement par un humain (sans ce préfixe) n'est jamais touché.
export const AI_LABEL_PREFIX = "🤖 ";

// Couleur de repli si le label d'origine n'existe pas encore / n'est pas lisible.
export const AI_LABEL_FALLBACK_COLOR = "8A2BE2";

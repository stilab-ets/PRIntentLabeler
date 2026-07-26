export const BOT_COMMENT_MARKER = "<!-- llm-pr-labeler -->";
export const MAX_FILES_IN_COMMENT = 20;

// Nombre maximum de fichiers (les mieux scorés) dont le diff est envoyé au LLM.
// Valeur conservative pour respecter la limite TPM du tier gratuit Groq (6 000 tokens/min).
export const MAX_FILES_FOR_LLM = 6;

// Nombre maximum de lignes conservées par patch avant troncature.
export const MAX_PATCH_LINES_PER_FILE = 60;

// Budget estimé des patches. Trois caractères par token est une approximation
// plus prudente que quatre pour du code source (tokens souvent courts : `{`, `=>`...).
export const ESTIMATED_CHARS_PER_TOKEN = 3;
export const MAX_PATCH_TOKENS_PER_FILE = 750;
export const MAX_TOTAL_PATCH_TOKENS = 2_500;

// Budget global du prompt envoyé au LLM (system + user), toutes sections
// confondues, réserve pour la réponse comprise. Le budget réel des patches
// (voir pr-context.ts) est dérivé de cette limite moins tout ce qui n'est pas
// un patch (métadonnées, description, labels, résumés de fichiers...).
export const MAX_LLM_CONTEXT_TOKENS = 6_000;
export const LLM_RESPONSE_TOKEN_RESERVE = 1_000;

// Les limites en caractères restent utiles à la troncature et sont dérivées
// du budget de tokens pour éviter deux configurations contradictoires.
export const MAX_PATCH_CHARS_PER_FILE =
  MAX_PATCH_TOKENS_PER_FILE * ESTIMATED_CHARS_PER_TOKEN;
export const MAX_TOTAL_PATCH_CHARS =
  MAX_TOTAL_PATCH_TOKENS * ESTIMATED_CHARS_PER_TOKEN;

// Les descriptions de PR automatisées (Dependabot, changelogs, templates)
// peuvent être immenses. Le début contient généralement l'intention utile.
export const MAX_PR_BODY_CHARS = 1_500;

// Les grands dépôts peuvent avoir plusieurs centaines de labels de statut,
// d'équipe ou de taille. On conserve les candidats d'intention les plus utiles.
export const MAX_REPOSITORY_LABELS_FOR_LLM = 30;

// Taille maximale du résumé de tous les fichiers inclus dans le contexte.
export const MAX_ALL_FILES_SUMMARY = 30;

// Bonus si un token exact du titre de la PR apparaît dans le chemin du fichier.
// Le bonus "body" (moins fort) ne s'applique que si le titre ne matche pas déjà.
export const PR_TITLE_MATCH_BONUS = 3;
export const PR_BODY_MATCH_BONUS = 1;

// Le score est une priorité interne de tri, pas une note sur une échelle
// fixe : il peut dépasser toute borne visuelle. On l'affiche donc en "pts"
// et jamais sous forme de fraction (ex. "23/20" serait trompeur).
export function formatFileScore(score: number): string {
  return `${score} pts`;
}

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

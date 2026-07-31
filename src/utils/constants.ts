export const BOT_COMMENT_MARKER = "<!-- llm-pr-labeler -->";
// Aligné sur le plafond de sélection pour que le commentaire liste tout ce
// qui a réellement été envoyé au LLM.
export const MAX_FILES_IN_COMMENT = 25;

// Plafond de sécurité, et non nombre visé : le nombre de fichiers réellement
// envoyés découle du budget de jetons disponible. Ce plafond borne la taille du
// prompt, la latence et le coût même quand la fenêtre du modèle est immense.
export const MAX_FILES_FOR_LLM = 25;

// En dessous de ce budget, l'extrait d'un diff ne montre plus rien d'utile :
// mieux vaut un fichier de moins et des extraits lisibles que dix fragments
// illisibles.
export const MIN_PATCH_TOKENS_PER_FILE = 120;

// Nombre maximum de lignes conservées par patch avant troncature.
export const MAX_PATCH_LINES_PER_FILE = 60;

const configuredCharsPerToken = Number.parseFloat(
  process.env.ESTIMATED_CHARS_PER_TOKEN ?? "3",
);
export const ESTIMATED_CHARS_PER_TOKEN =
  Number.isFinite(configuredCharsPerToken) && configuredCharsPerToken > 0
    ? configuredCharsPerToken
    : 3;
export const MAX_PATCH_TOKENS_PER_FILE = 750;

// Plafond de coût pour les diffs (pas la fenêtre du modèle) : on n'utilise
// jamais plus que ce que le LLM offre, mais on coupe aussi ici pour éviter
// latence/quota excessifs. Surchargeable via MAX_TOTAL_PATCH_TOKENS.
const configuredTotalPatchTokens = Number.parseInt(
  process.env.MAX_TOTAL_PATCH_TOKENS ?? "",
  10,
);
export const MAX_TOTAL_PATCH_TOKENS =
  Number.isFinite(configuredTotalPatchTokens) && configuredTotalPatchTokens > 0
    ? configuredTotalPatchTokens
    : 10_000;

// Marge entre notre estimation (caractères / 3) et le tokenizer réel du
// fournisseur, qui diffère d'un modèle à l'autre.
export const LLM_PROMPT_SAFETY_RATIO = 0.85;

// Part maximale de la fenêtre réservée à la réponse, pour qu'un modèle à petite
// fenêtre garde de la place pour le prompt.
export const LLM_RESPONSE_RESERVE_MAX_RATIO = 0.25;

// Plafond de jetons accordé à la réponse du modèle, aussi utilisé comme
// `max_tokens` par les fournisseurs. Le JSON attendu est court, mais les modèles
// à raisonnement (Gemini 2.5+, o-series, R1) imputent leurs jetons de réflexion
// sur ce même plafond : trop bas, ils épuisent le budget en réfléchissant et
// renvoient une réponse vide. On garde donc une marge large.
export const LLM_RESPONSE_TOKEN_RESERVE = 3_000;

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

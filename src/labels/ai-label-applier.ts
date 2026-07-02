import type { Context } from "probot";
import { AI_LABEL_FALLBACK_COLOR } from "../utils/constants.js";
import { toAiLabelName } from "./ai-label-name.js";
import { applyLabels } from "./label-applier.js";

type OctokitLike = Context<"check_run">["octokit"];

// Crée (si besoin) la variante "🤖 <nom>" d'un label suggéré par le LLM, en
// reprenant si possible la couleur du label d'origine pour rester cohérent
// visuellement (ex. "bug" est rouge -> "🤖 bug" aussi).
async function ensureAiLabelExists(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  baseName: string,
  aiName: string,
): Promise<void> {
  let color = AI_LABEL_FALLBACK_COLOR;
  try {
    const { data } = await octokit.issues.getLabel({
      owner,
      repo,
      name: baseName,
    });
    if (data.color) color = data.color;
  } catch {
    // Le label de base n'existe pas ou n'est pas lisible : couleur par défaut.
  }

  try {
    await octokit.issues.createLabel({
      owner,
      repo,
      name: aiName,
      color,
      description: `Label "${baseName}" suggéré automatiquement par le LLM.`,
    });
  } catch (error) {
    const status = (error as { status?: number } | undefined)?.status;
    if (status !== 422) throw error; // 422 = le label existe déjà
  }
}

// Applique des labels suggérés par le LLM sur la PR, sous leur forme
// "🤖 <nom>". N'affecte jamais un label identique posé manuellement par un
// humain, puisque ce dernier n'a pas le préfixe et reste un label distinct.
export async function applyAiSuggestedLabels(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  issueNumber: number,
  suggestionNames: string[],
): Promise<void> {
  if (suggestionNames.length === 0) return;

  const aiNames: string[] = [];
  for (const name of suggestionNames) {
    const aiName = toAiLabelName(name);
    await ensureAiLabelExists(octokit, owner, repo, name, aiName);
    aiNames.push(aiName);
  }

  await applyLabels(octokit, owner, repo, issueNumber, aiNames);
}

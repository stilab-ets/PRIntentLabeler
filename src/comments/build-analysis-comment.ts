import type {
  PullRequestData,
  PullRequestLlmContext,
} from "../domain/pull-request-data.js";
import type { PullRequestAnalysis } from "../domain/llm-analysis.js";
import {
  BOT_COMMENT_MARKER,
  formatFileScore,
  MAX_FILES_IN_COMMENT,
  MIN_CONFIDENCE_TO_SUGGEST,
} from "../utils/constants.js";
import { toAiLabelName } from "../labels/ai-label-name.js";
import {
  renderAnalysisDataBlock,
  renderCheckboxLines,
} from "./comment-state.js";

export function buildAnalysisComment(
  prData: PullRequestData,
  context: PullRequestLlmContext,
  analysis: PullRequestAnalysis | null = null,
  appliedLabels: string[] = [],
): string {
  const selected = context.selectedFiles.slice(0, MAX_FILES_IN_COMMENT);

  const selectedTable =
    selected.length > 0
      ? selected
          .map((ranked) => {
            const f = ranked.file;
            const reasons = ranked.reasons.join(", ") || "—";
            return `| \`${f.filename}\` | ${f.status} | +${f.additions}/-${f.deletions} | ${formatFileScore(ranked.score)} | ${reasons} |`;
          })
          .join("\n")
      : "| _Aucun fichier sélectionné_ | | | | |";

  const filesSection = `### Fichiers sélectionnés pour l'analyse

> Les fichiers ci-dessous ont été sélectionnés automatiquement par le backend et utilisés pour construire le contexte envoyé au LLM. Le score est une priorité interne de tri (diagnostic), il n'est jamais envoyé au LLM.

| Fichier | Statut | Changements | Score | Raisons |
|---|---|---|---|---|
${selectedTable}`;

  const labelsSection = buildLabelsSection(prData, analysis, appliedLabels);

  const summarySection =
    analysis && analysis.summary
      ? `\n###  Résumé\n\n${analysis.summary}\n`
      : "";

  const dataBlock = analysis
    ? `\n${renderAnalysisDataBlock(analysis, prData.headSha)}`
    : "";

  return `${BOT_COMMENT_MARKER}
##  LLM PR Labeler — Analyse

L'application a bien reçu et analysé cette Pull Request.

| Champ | Valeur |
|---|---|
| PR | #${prData.number} |
| Titre | ${escapeMarkdownTableValue(prData.title)} |
| Auteur | \`${prData.author}\` |
| Branche source | \`${prData.headBranch}\` |
| Branche cible | \`${prData.baseBranch}\` |
| Changements | +${prData.additions} / -${prData.deletions} |
| Fichiers modifiés | ${prData.changedFilesCount} |
| Fichiers analysés par le LLM | ${context.selectedFilesCount} |
| Fichiers résumés seulement (lockfile/snapshot/généré) | ${context.summaryOnlyFilesCount} |

${filesSection}

${labelsSection}${summarySection}${dataBlock}`;
}

function buildLabelsSection(
  prData: PullRequestData,
  analysis: PullRequestAnalysis | null,
  appliedLabels: string[],
): string {
  if (analysis && analysis.suggestions.length > 0) {
    const checkboxes = renderCheckboxLines(analysis.suggestions, appliedLabels);
    const appliedNote =
      appliedLabels.length > 0
        ? `\n\n> ${appliedLabels.length} label(s) actuellement appliqué(s) : ${appliedLabels
            .map((label) => `\`${toAiLabelName(label)}\``)
            .join(", ")}.`
        : "\n\n> Aucun label appliqué pour l'instant.";

    return `###  Labels suggérés — coche ceux à appliquer

> Coche/décoche une case pour appliquer ou retirer le label correspondant sur cette PR.
> Un label appliqué par l'IA porte toujours l'icône 🤖 devant son nom (ex. \`🤖 bug\`) pour le distinguer d'un label ajouté manuellement par un humain, qui n'affiche jamais cette icône.

${checkboxes}${appliedNote}`;
  }

  const availableLabels =
    prData.repositoryLabels.length > 0
      ? prData.repositoryLabels.map((label) => `\`${label}\``).join(", ")
      : "_Aucun label trouvé dans le repo._";

  // Une analyse absente (panne du fournisseur) et une analyse aboutie sans
  // label retenu produisaient le même message : impossible de savoir laquelle.
  const reason = analysis
    ? `Le LLM a analysé cette PR mais aucun label du repo n'a atteint le seuil de confiance de ${Math.round(MIN_CONFIDENCE_TO_SUGGEST * 100)} %.`
    : "L'analyse LLM n'a pas abouti (fournisseur indisponible, réponse vide ou réponse hors contrat JSON). Consulte les logs de l'application.";

  return `### Labels disponibles dans le repo

${availableLabels}

>  ${reason}`;
}

function escapeMarkdownTableValue(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

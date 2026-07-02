import type {
  PullRequestData,
  PullRequestLlmContext,
} from "../domain/pull-request-data.js";
import type { PullRequestAnalysis } from "../domain/llm-analysis.js";
import {
  BOT_COMMENT_MARKER,
  MAX_FILES_IN_COMMENT,
} from "../utils/constants.js";
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
            return `| \`${f.filename}\` | ${f.status} | +${f.additions}/-${f.deletions} | ${ranked.score} | ${reasons} |`;
          })
          .join("\n")
      : "| _Aucun fichier sélectionné_ | | | | |";

  const filesSection = `### Fichiers sélectionnés pour l'analyse

> Les fichiers ci-dessous ont été sélectionnés automatiquement par le backend et utilisés pour construire le contexte envoyé au LLM.

| Fichier | Statut | Changements | Score | Raisons |
|---|---|---|---|---|
${selectedTable}`;

  const labelsSection = buildLabelsSection(prData, analysis, appliedLabels);

  const summarySection =
    analysis && analysis.summary
      ? `\n###  Résumé\n\n${analysis.summary}\n`
      : "";

  const dataBlock = analysis ? `\n${renderAnalysisDataBlock(analysis)}` : "";

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
| Fichiers ignorés | ${context.ignoredFilesCount} |

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
            .map((label) => `\`${label}\``)
            .join(", ")}.`
        : "\n\n> Aucun label appliqué pour l'instant.";

    return `###  Labels suggérés — coche ceux à appliquer

> Coche/décoche une case pour appliquer ou retirer le label correspondant sur cette PR.

${checkboxes}${appliedNote}`;
  }

  const availableLabels =
    prData.repositoryLabels.length > 0
      ? prData.repositoryLabels.map((label) => `\`${label}\``).join(", ")
      : "_Aucun label trouvé dans le repo._";

  return `### Labels disponibles dans le repo

${availableLabels}

>  Aucune suggestion LLM disponible pour cette PR.`;
}

function escapeMarkdownTableValue(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

import type { PullRequestAnalysis } from "../domain/llm-analysis.js";
import type { LabelSuggestion } from "../domain/label-suggestion.js";
import { toAiLabelName, stripAiLabelName } from "../labels/ai-label-name.js";

// Bloc HTML invisible qui stocke l'analyse LLM de façon machine-readable,
// pour que les handlers (clic bouton, case cochée) puissent agir sans
// rappeler le LLM. Encodé en base64 pour rester robuste à tout texte.
//
// Depuis la version 2, ce bloc porte aussi le `headSha` analysé : une action
// de Check Run doit refuser d'appliquer/retirer un label si la PR a reçu un
// nouveau push depuis, pour ne jamais agir sur une analyse périmée.
const DATA_PREFIX = "<!-- llm-pr-labeler:data ";
const DATA_SUFFIX = " -->";
const DATA_REGEX = /<!-- llm-pr-labeler:data ([A-Za-z0-9+/=]+) -->/;

export type StoredAnalysisState = {
  version: 1 | 2;
  // null seulement pour un ancien commentaire (version 1) qui ne portait pas
  // le SHA analysé : son état est alors considéré comme non vérifiable.
  headSha: string | null;
  analysis: PullRequestAnalysis;
};

type StoredAnalysisStateV2 = {
  version: 2;
  headSha: string;
  analysis: PullRequestAnalysis;
};

function isPullRequestAnalysis(value: unknown): value is PullRequestAnalysis {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { suggestions?: unknown }).suggestions)
  );
}

export function renderAnalysisDataBlock(
  analysis: PullRequestAnalysis,
  headSha: string,
): string {
  const state: StoredAnalysisStateV2 = { version: 2, headSha, analysis };
  const json = JSON.stringify(state);
  const encoded = Buffer.from(json, "utf8").toString("base64");
  return `${DATA_PREFIX}${encoded}${DATA_SUFFIX}`;
}

export function parseAnalysisDataBlock(body: string): StoredAnalysisState | null {
  const match = body.match(DATA_REGEX);
  if (!match) return null;

  try {
    const json = Buffer.from(match[1], "base64").toString("utf8");
    const parsed = JSON.parse(json) as Record<string, unknown>;

    // Format v2 : { version: 2, headSha, analysis }.
    if (
      parsed.version === 2 &&
      typeof parsed.headSha === "string" &&
      isPullRequestAnalysis(parsed.analysis)
    ) {
      return {
        version: 2,
        headSha: parsed.headSha,
        analysis: parsed.analysis,
      };
    }

    // Format v1 (historique) : le blob est directement un PullRequestAnalysis,
    // sans version ni headSha. On le parse sans planter, mais il est traité
    // comme non vérifiable (headSha: null) par les handlers.
    if (isPullRequestAnalysis(parsed)) {
      return { version: 1, headSha: null, analysis: parsed };
    }

    return null;
  } catch {
    return null;
  }
}

// Rendu d'une ligne de case à cocher par label suggéré.
// Une case est cochée si le label fait partie de `checkedLabels`.
// Le nom affiché porte le préfixe "🤖 " : c'est exactement le nom du label
// tel qu'il apparaît réellement sur la PR une fois appliqué par le bot.
export function renderCheckboxLines(
  suggestions: LabelSuggestion[],
  checkedLabels: string[],
): string {
  const checked = new Set(checkedLabels.map((l) => l.toLowerCase()));
  return suggestions
    .map((s) => {
      const box = checked.has(s.name.toLowerCase()) ? "x" : " ";
      const pct = Math.round(s.confidence * 100);
      return `- [${box}] \`${toAiLabelName(s.name)}\` — ${pct}% — ${s.reason}`;
    })
    .join("\n");
}

// Extrait les labels cochés (- [x]) du corps d'un commentaire.
// Retourne les noms bruts (sans le préfixe "🤖 ") pour rester compatibles
// avec le reste du code, qui manipule les suggestions par leur nom d'origine.
export function parseCheckedLabels(body: string): string[] {
  const regex = /^- \[([ xX])\] `([^`]+)`/gm;
  const checked: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    if (match[1].toLowerCase() === "x") checked.push(stripAiLabelName(match[2]));
  }
  return checked;
}

// Extrait tous les labels présents dans les cases (cochés ou non), noms bruts.
export function parseAllCheckboxLabels(body: string): string[] {
  const regex = /^- \[[ xX]\] `([^`]+)`/gm;
  const labels: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    labels.push(stripAiLabelName(match[1]));
  }
  return labels;
}

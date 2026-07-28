import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  PullRequestData,
  PullRequestFileData,
} from "../src/domain/pull-request-data.js";
import {
  buildAblationContexts,
  calculateSetMetrics,
  type AblationVariant,
  type SetMetrics,
} from "../src/evaluation/selector-ablation.js";
import {
  buildClassificationPromptForAblation,
  buildClassificationSystemPrompt,
} from "../src/llm/prompt-builder.js";
import {
  GroqProvider,
  type GroqUsageMetrics,
} from "../src/llm/groq-provider.js";
import { filterValidSuggestions } from "../src/labels/label-policy.js";
import { estimateTokens } from "../src/llm/patch-utils.js";

type AnnotatedPullRequest = {
  id: string;
  title: string;
  body?: string;
  expectedLabels: string[];
  repositoryLabels: string[];
  repositoryLabelDescriptions?: Record<string, string>;
  files: PullRequestFileData[];
  owner?: string;
  repo?: string;
  number?: number;
  author?: string;
  baseBranch?: string;
  headBranch?: string;
  headSha?: string;
  htmlUrl?: string;
};

type EvaluationDataset = {
  version: 1;
  pullRequests: AnnotatedPullRequest[];
};

type Result = {
  pullRequestId: string;
  variant: AblationVariant;
  expectedLabels: string[];
  predictedLabels: string[];
  metrics: SetMetrics;
  selectedFiles: string[];
  estimatedPromptTokens: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

const variants: AblationVariant[] = [
  "A-title",
  "B-title-roles",
  "C-scored-diffs",
  "D-random-diffs",
];

function toPullRequestData(entry: AnnotatedPullRequest): PullRequestData {
  const additions = entry.files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = entry.files.reduce((sum, file) => sum + file.deletions, 0);

  return {
    owner: entry.owner ?? "evaluation",
    repo: entry.repo ?? "dataset",
    number: entry.number ?? 1,
    title: entry.title,
    body: entry.body ?? "",
    author: entry.author ?? "annotated-dataset",
    baseBranch: entry.baseBranch ?? "main",
    headBranch: entry.headBranch ?? "evaluation",
    headSha: entry.headSha ?? entry.id,
    htmlUrl: entry.htmlUrl ?? "",
    additions,
    deletions,
    changedFilesCount: entry.files.length,
    files: entry.files,
    repositoryLabels: entry.repositoryLabels,
    repositoryLabelDescriptions: entry.repositoryLabelDescriptions,
    pullRequestLabels: [],
  };
}

function averageMetrics(results: Result[]): SetMetrics {
  const divisor = results.length || 1;
  return results.reduce<SetMetrics>(
    (totals, result) => ({
      exactSetAccuracy:
        totals.exactSetAccuracy + result.metrics.exactSetAccuracy / divisor,
      precision: totals.precision + result.metrics.precision / divisor,
      recall: totals.recall + result.metrics.recall / divisor,
      f1: totals.f1 + result.metrics.f1 / divisor,
      jaccard: totals.jaccard + result.metrics.jaccard / divisor,
    }),
    {
      exactSetAccuracy: 0,
      precision: 0,
      recall: 0,
      f1: 0,
      jaccard: 0,
    },
  );
}

function parseArguments(): {
  datasetPath?: string;
  outputPath?: string;
  seed: number;
} {
  const args = process.argv.slice(2);
  let datasetPath: string | undefined;
  let outputPath: string | undefined;
  let seed = 20_260_726;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--output") {
      outputPath = args[index + 1];
      index += 1;
    } else if (argument === "--seed") {
      const parsed = Number.parseInt(args[index + 1] ?? "", 10);
      if (Number.isFinite(parsed)) seed = parsed;
      index += 1;
    } else if (!argument.startsWith("--") && !datasetPath) {
      datasetPath = argument;
    }
  }

  return { datasetPath, outputPath, seed };
}

async function loadDataset(path: string): Promise<EvaluationDataset> {
  const parsed = JSON.parse(await readFile(resolve(path), "utf8")) as
    | EvaluationDataset
    | undefined;
  if (
    parsed?.version !== 1 ||
    !Array.isArray(parsed.pullRequests) ||
    parsed.pullRequests.length === 0
  ) {
    throw new Error(
      "Le dataset doit contenir au moins une PR annotée dans pullRequests.",
    );
  }
  return parsed;
}

const { datasetPath, outputPath, seed } = parseArguments();
if (!datasetPath) {
  console.error(
    "Données annotées manquantes. Usage: npm run eval:selector -- <dataset.json> [--output resultats.json] [--seed 20260726]",
  );
  process.exit(1);
}
if (!process.env.GROQ_API_KEY) {
  console.error(
    "GROQ_API_KEY est requis pour exécuter les quatre variantes avec le même modèle.",
  );
  process.exit(1);
}

const dataset = await loadDataset(datasetPath);
const model = process.env.GROQ_MODEL ?? "llama-3.1-8b-instant";
let latestUsage: GroqUsageMetrics | null = null;
const provider = new GroqProvider(
  process.env.GROQ_API_KEY,
  model,
  undefined,
  (usage) => {
    latestUsage = usage;
  },
);
const results: Result[] = [];

for (let index = 0; index < dataset.pullRequests.length; index += 1) {
  const annotated = dataset.pullRequests[index];
  const prData = toPullRequestData(annotated);
  const contexts = buildAblationContexts(prData, seed + index);

  for (const variant of variants) {
    const context = contexts[variant];
    const prompt = buildClassificationPromptForAblation(context, variant);
    latestUsage = null;
    const analysis = await provider.classifyPullRequestWithPrompt(prompt);
    const predictedLabels = filterValidSuggestions(
      analysis.suggestions,
      annotated.repositoryLabels,
    ).map((suggestion) => suggestion.name);
    const usage = latestUsage;

    results.push({
      pullRequestId: annotated.id,
      variant,
      expectedLabels: annotated.expectedLabels,
      predictedLabels,
      metrics: calculateSetMetrics(annotated.expectedLabels, predictedLabels),
      selectedFiles: context.selectedFiles.map(
        (selected) => selected.file.filename,
      ),
      estimatedPromptTokens:
        estimateTokens(buildClassificationSystemPrompt()) +
        estimateTokens(prompt),
      promptTokens: usage?.promptTokens ?? null,
      completionTokens: usage?.completionTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
    });
  }
}

const aggregate = Object.fromEntries(
  variants.map((variant) => [
    variant,
    averageMetrics(results.filter((result) => result.variant === variant)),
  ]),
);
const output = JSON.stringify(
  {
    dataset: resolve(datasetPath),
    model,
    seed,
    pullRequestCount: dataset.pullRequests.length,
    aggregate,
    results,
  },
  null,
  2,
);

if (outputPath) {
  await writeFile(resolve(outputPath), `${output}\n`, "utf8");
  console.log(`Résultats écrits dans ${resolve(outputPath)}`);
} else {
  console.log(output);
}

const INTENT_TERMS = [
  "bug",
  "bugfix",
  "fix",
  "feature",
  "enhancement",
  "refactor",
  "cleanup",
  "documentation",
  "docs",
  "test",
  "testing",
  "ci",
  "build",
  "deploy",
  "dependency",
  "dependencies",
  "deps",
  "security",
  "performance",
  "breaking",
  "api change",
  "deprecation",
  "regression",
  "flake",
  "flaky",
];

const META_LABEL_PATTERNS = [
  /(^|[/:_-])size([/:_-]|$)/,
  /(^|[/:_-])priority([/:_-]|$)/,
  /(^|[/:_-])area([/:_-]|$)/,
  /(^|[/:_-])team([/:_-]|$)/,
  /(^|[/:_-])sig([/:_-]|$)/,
  /(^|[/:_-])wg([/:_-]|$)/,
  /(^|[/:_-])status([/:_-]|$)/,
  /(^|[/:_-])needs([/:_-]|$)/,
  /cla[/: _-]/,
  /triage/,
  /good first issue/,
  /help wanted/,
  /stale/,
  /duplicate/,
  /review/,
];

function scoreLabel(name: string, description: string): number {
  const normalizedName = name.toLowerCase().replace(/[-_/]+/g, " ");
  const normalizedDescription = description
    .toLowerCase()
    .replace(/[-_/]+/g, " ");
  const evidence = `${normalizedName} ${normalizedDescription}`;
  const evidenceTokens = new Set(evidence.split(/\s+/).filter(Boolean));
  let score = description.trim() ? 2 : 0;

  for (const term of INTENT_TERMS) {
    const matches = term.includes(" ")
      ? evidence.includes(term)
      : evidenceTokens.has(term);
    if (matches) score += 12;
  }

  if (/^(type|kind)[/: _-]/.test(name.toLowerCase())) score += 10;

  for (const pattern of META_LABEL_PATTERNS) {
    if (pattern.test(name.toLowerCase())) score -= 15;
  }

  return score;
}

export function selectCandidateLabels(
  labels: string[],
  descriptions: Record<string, string>,
  limit: number,
): string[] {
  if (labels.length <= limit) return [...labels];

  return labels
    .map((name, originalIndex) => ({
      name,
      originalIndex,
      score: scoreLabel(name, descriptions[name] ?? ""),
    }))
    .sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex)
    .slice(0, limit)
    .map((label) => label.name);
}

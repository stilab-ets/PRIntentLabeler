import type {
  FileContentPolicy,
  PullRequestFileData,
  PullRequestFileRole,
  RankedPullRequestFile,
} from "../domain/pull-request-data.js";
import {
  PR_BODY_MATCH_BONUS,
  PR_TITLE_MATCH_BONUS,
} from "../utils/constants.js";

// Un lockfile est un signal fort ("cette PR touche aux dépendances") mais son
// contenu est généré mécaniquement : jamais utile en diff, souvent énorme.
// Rôle "dependency" + contentPolicy "summary-only" (voir determineContentPolicy).
const LOCKFILE_BASENAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "composer.lock",
  "gemfile.lock",
  "cargo.lock",
  "poetry.lock",
  "pipfile.lock",
  "uv.lock",
  "go.sum",
  "packages.lock.json",
]);

// Répertoires dont le contenu est systématiquement généré ou vendored :
// jamais du code "source" écrit par un humain pour cette PR.
const GENERATED_DIRECTORIES = [
  "dist",
  "coverage",
  ".next",
  "node_modules",
  ".cache",
  ".turbo",
  "generated",
  "gen",
  "__generated__",
];

// Extensions binaires, compilées ou minifiées : aucune valeur sémantique en diff.
const GENERATED_EXTENSIONS = [
  ".min.js",
  ".min.css",
  ".map",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".tiff",
  ".zip",
  ".tar",
  ".gz",
  ".7z",
  ".pdf",
  ".mp3",
  ".mp4",
  ".mov",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".class",
  ".jar",
  ".exe",
  ".dll",
];

const DEPENDENCY_MANIFESTS = new Set([
  "package.json",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "requirements.txt",
  "pyproject.toml",
  "pipfile",
  "gemfile",
  "cargo.toml",
  "go.mod",
  "composer.json",
  "mix.exs",
]);

const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".java",
  ".kt",
  ".kts",
  ".go",
  ".rs",
  ".cs",
  ".cpp",
  ".cc",
  ".c",
  ".h",
  ".hpp",
  ".rb",
  ".php",
  ".swift",
  ".scala",
  ".vue",
  ".svelte",
  ".html",
  ".htm",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".lua",
  ".ex",
  ".exs",
  ".dart",
];

// Scores de base sur une échelle ~20 pour rester lisibles ; le total réel
// (avec bonus/malus) peut dépasser cette valeur, ce n'est pas une note fixe.
const ROLE_BASE_SCORES: Record<PullRequestFileRole, number> = {
  source: 14,
  database: 13,
  "ci-cd": 12,
  dependency: 12,
  configuration: 10,
  documentation: 9,
  test: 9,
  other: 7,
  asset: 5,
  generated: 1,
};

// Mots trop génériques pour être un signal utile de correspondance titre/chemin.
const PR_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "into",
  "fix",
  "fixes",
  "fixed",
  "feat",
  "feature",
  "add",
  "adds",
  "added",
  "update",
  "updates",
  "updated",
  "remove",
  "removes",
  "removed",
  "refactor",
  "chore",
  "docs",
  "doc",
  "test",
  "tests",
  "pull",
  "request",
  "bug",
  "une",
  "des",
  "les",
  "pour",
  "avec",
  "dans",
  "sur",
  "par",
]);

const SECURITY_TOKENS = new Set([
  "auth",
  "authentication",
  "authorization",
  "oauth",
  "login",
  "logout",
  "jwt",
  "credential",
  "credentials",
  "password",
  "security",
  "permission",
  "permissions",
  "rbac",
  "acl",
  "csrf",
  "cors",
  "crypto",
]);

const PERFORMANCE_TOKENS = new Set([
  "cache",
  "caching",
  "perf",
  "performance",
  "benchmark",
  "benchmarks",
  "latency",
  "throughput",
  "memoize",
  "debounce",
  "throttle",
]);

const PUBLIC_BEHAVIOR_TOKENS = ["controller", "service", "router", "endpoint"];

export type FileScoreContext = {
  title?: string;
  body?: string;
};

/**
 * Tokenizer unique, réutilisé pour le titre, la description ET le chemin de
 * fichier, afin que les trois signaux soient comparables terme à terme :
 * - enlève les accents (userService === user_service === user-service);
 * - découpe le camelCase (authService -> auth, service);
 * - découpe la ponctuation (_, -, /, ., espaces...);
 * - ignore les tokens numériques et les tokens de moins de 3 caractères;
 * - ignore les mots-outils trop génériques (PR_STOP_WORDS).
 */
export function tokenizeText(text: string): Set<string> {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();

  return new Set(
    normalized
      .split(/[^a-z0-9]+/)
      .filter(
        (token) =>
          token.length >= 3 &&
          !/^\d+$/.test(token) &&
          !PR_STOP_WORDS.has(token),
      ),
  );
}

// Conservé pour compatibilité (scripts / affichage) : tous les mots-clés
// utiles du titre + de la description, fusionnés en une seule liste.
export function extractPrKeywords(
  title: string = "",
  body: string = "",
): string[] {
  return [...tokenizeText(`${title} ${body}`)];
}

function basename(filename: string): string {
  const parts = filename.split("/");
  return parts[parts.length - 1] ?? filename;
}

function pathSegments(filename: string): string[] {
  return filename.toLowerCase().split("/").filter(Boolean);
}

function isInDirectory(
  context: FilePathContext,
  directories: string[],
): boolean {
  return directories.some((directory) => context.segments.includes(directory));
}

type FilePathContext = {
  path: string;
  base: string;
  extension: string;
  segments: string[];
  tokens: Set<string>;
};

function buildFilePathContext(filename: string): FilePathContext {
  const path = filename.toLowerCase();
  const base = basename(path);
  const extensionStart = base.lastIndexOf(".");

  return {
    path,
    base,
    extension: extensionStart > 0 ? base.slice(extensionStart) : "",
    segments: pathSegments(path),
    tokens: tokenizeText(filename),
  };
}

function intersects(a: Set<string>, b: Iterable<string>): boolean {
  for (const token of b) {
    if (a.has(token)) return true;
  }
  return false;
}

function isSnapshotFile(context: FilePathContext): boolean {
  return (
    context.segments.includes("__snapshots__") || context.path.endsWith(".snap")
  );
}

function isLockfile(context: FilePathContext): boolean {
  return LOCKFILE_BASENAMES.has(context.base);
}

// Bruit pur : jamais un rôle "source", jamais un patch envoyé, quel que soit
// le score. Vérifié avant toute autre règle de rôle.
function isGeneratedLooking(context: FilePathContext): boolean {
  return (
    isInDirectory(context, GENERATED_DIRECTORIES) ||
    context.base.includes(".generated.") ||
    context.base.endsWith(".pb.go") ||
    context.base.endsWith(".g.cs") ||
    GENERATED_EXTENSIONS.some((extension) => context.base.endsWith(extension))
  );
}

type RoleRule = {
  role: Exclude<PullRequestFileRole, "generated" | "other" | "dependency">;
  matches: (context: FilePathContext) => boolean;
};

// L'ordre est intentionnel : un test sous src/ reste un test, et un workflow
// YAML reste de la CI plutôt qu'un simple fichier de configuration.
const ROLE_RULES: RoleRule[] = [
  {
    role: "ci-cd",
    matches: ({ path, base, segments }) =>
      path.startsWith(".github/workflows/") ||
      path.startsWith(".github/actions/") ||
      segments.includes(".circleci") ||
      base === ".gitlab-ci.yml" ||
      base === "jenkinsfile" ||
      base === "azure-pipelines.yml" ||
      base === "azure-pipelines.yaml" ||
      base.startsWith("dockerfile"),
  },
  {
    role: "test",
    matches: ({ path, base, segments }) =>
      [
        "test",
        "tests",
        "__tests__",
        "spec",
        "specs",
        "fixtures",
        "__snapshots__",
        "e2e",
      ].some((segment) => segments.includes(segment)) ||
      base.includes(".spec.") ||
      base.includes(".test.") ||
      base.endsWith("_test.go") ||
      base.endsWith("_test.py") ||
      base.startsWith("test_") ||
      base.endsWith("test.java") ||
      base.endsWith("tests.java") ||
      path.endsWith(".snap"),
  },
  {
    role: "documentation",
    matches: ({ base, extension, segments }) =>
      ["docs", "doc", "documentation"].some((segment) =>
        segments.includes(segment),
      ) ||
      [".md", ".mdx", ".rst", ".adoc"].includes(extension) ||
      base.startsWith("readme") ||
      base.startsWith("changelog") ||
      base.startsWith("contributing"),
  },
  {
    role: "database",
    matches: (context) =>
      isInDirectory(context, ["database", "db", "migration", "migrations"]) ||
      [".sql", ".prisma"].includes(context.extension) ||
      intersects(context.tokens, ["database", "migration", "prisma"]),
  },
  {
    role: "configuration",
    matches: ({ base, extension, segments }) =>
      ["config", "configs", "settings"].some((segment) =>
        segments.includes(segment),
      ) ||
      base.startsWith("config.") ||
      base.startsWith("settings.") ||
      base.includes(".config.") ||
      base.startsWith(".env") ||
      base === "tsconfig.json" ||
      base.startsWith("tsconfig.") ||
      base === "jsconfig.json" ||
      [".yml", ".yaml", ".toml", ".ini"].includes(extension),
  },
  {
    role: "asset",
    matches: ({ extension }) =>
      [".svg", ".css", ".scss", ".sass", ".less"].includes(extension),
  },
  {
    role: "source",
    matches: ({ path, extension }) =>
      hasPathSegment(path, ["src", "app", "server", "backend", "api", "lib"]) ||
      SOURCE_EXTENSIONS.includes(extension),
  },
];

function hasPathSegment(filename: string, segments: string[]): boolean {
  const parts = pathSegments(filename);
  return segments.some((segment) => parts.includes(segment));
}

// Vrai si le fichier ne doit jamais recevoir de rôle "source" et ne peut
// jamais faire partie des diffs envoyés au LLM (voir aussi determineContentPolicy).
export function shouldIgnoreFile(filename: string): boolean {
  return classifyFileRole(filename) === "generated";
}

export function classifyFileRole(filename: string): PullRequestFileRole {
  const context = buildFilePathContext(filename);

  // Le bruit généré/binaire est exclu avant même de regarder s'il s'agit
  // d'un lockfile ou d'un chemin "source" : un fichier sous dist/ ou node_modules/
  // reste "generated" même s'il porte l'extension .ts.
  if (isGeneratedLooking(context)) return "generated";
  if (isLockfile(context)) return "dependency";
  if (
    DEPENDENCY_MANIFESTS.has(context.base) ||
    context.base.startsWith("requirements-") ||
    context.base.startsWith("requirements.")
  ) {
    return "dependency";
  }

  return ROLE_RULES.find((rule) => rule.matches(context))?.role ?? "other";
}

// Sépare le rôle sémantique du droit d'envoyer le patch complet au LLM :
// un lockfile ou un snapshot reste un signal utile (visible dans le résumé),
// mais son contenu volumineux/généré ne doit jamais consommer le budget de patch.
function determineContentDecision(
  filename: string,
  role: PullRequestFileRole,
  patch: string | undefined,
): { policy: FileContentPolicy; reason?: string } {
  const context = buildFilePathContext(filename);

  if (role === "generated") {
    const generatedSource =
      isInDirectory(context, ["generated", "gen", "__generated__"]) ||
      context.base.includes(".generated.") ||
      context.base.endsWith(".pb.go") ||
      context.base.endsWith(".g.cs");
    return {
      policy: "summary-only",
      reason: generatedSource
        ? "generated source, diff omitted"
        : "generated or binary, diff omitted",
    };
  }
  if (role === "dependency" && isLockfile(context)) {
    return { policy: "summary-only", reason: "lockfile, diff omitted" };
  }
  if (role === "test" && isSnapshotFile(context)) {
    return { policy: "summary-only", reason: "snapshot, diff omitted" };
  }
  if (typeof patch !== "string" || patch.trim().length === 0) {
    return { policy: "summary-only", reason: "diff unavailable" };
  }

  return { policy: "include-patch" };
}

export function determineContentPolicy(
  filename: string,
  role: PullRequestFileRole,
  patch?: string,
): FileContentPolicy {
  return determineContentDecision(filename, role, patch).policy;
}

type Evaluation = {
  score: number;
  reasons: string[];
  role: PullRequestFileRole;
  contentPolicy: FileContentPolicy;
  contentReason?: string;
};

type PrKeywordContext = {
  titleKeywords: Set<string>;
  bodyKeywords: Set<string>;
};

function buildPrKeywordContext(context: FileScoreContext): PrKeywordContext {
  const titleKeywords = tokenizeText(context.title ?? "");
  const bodyKeywords = tokenizeText(context.body ?? "");
  return {
    titleKeywords,
    bodyKeywords,
  };
}

function evaluateFile(
  file: PullRequestFileData,
  prKeywords: PrKeywordContext,
): Evaluation {
  const context = buildFilePathContext(file.filename);
  const role = classifyFileRole(file.filename);
  const contentDecision = determineContentDecision(
    file.filename,
    role,
    file.patch,
  );
  const contentPolicy = contentDecision.policy;
  const contentReason = contentDecision.reason;

  if (role === "generated") {
    return {
      score: ROLE_BASE_SCORES.generated,
      reasons: ["generated or binary file (summary only)"],
      role,
      contentPolicy,
      contentReason,
    };
  }

  const reasons = [`${role} role`];
  let score = ROLE_BASE_SCORES[role];

  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(reason);
  };

  if (contentPolicy === "summary-only") {
    reasons.push("summary only (patch never sent)");
  }

  // Un token exact du titre pèse plus qu'un token de la description ; les
  // deux bonus ne se cumulent jamais pour éviter de sur-pondérer un même mot.
  const titleMatches = intersects(context.tokens, prKeywords.titleKeywords);
  const bodyMatches = intersects(context.tokens, prKeywords.bodyKeywords);
  if (titleMatches) {
    add(PR_TITLE_MATCH_BONUS, "matches PR title");
  } else if (bodyMatches) {
    add(PR_BODY_MATCH_BONUS, "matches PR description");
  }

  const hasSecurityPathSignal = intersects(context.tokens, SECURITY_TOKENS);
  const hasSecurityTitleSignal = intersects(
    prKeywords.titleKeywords,
    SECURITY_TOKENS,
  );
  if (hasSecurityPathSignal) {
    add(
      hasSecurityTitleSignal ? 3 : 1,
      hasSecurityTitleSignal
        ? "security signal confirmed by title"
        : "security path signal",
    );
  }

  const hasPerformancePathSignal = intersects(
    context.tokens,
    PERFORMANCE_TOKENS,
  );
  const hasPerformanceTitleSignal = intersects(
    prKeywords.titleKeywords,
    PERFORMANCE_TOKENS,
  );
  if (hasPerformancePathSignal) {
    add(
      hasPerformanceTitleSignal ? 3 : 1,
      hasPerformanceTitleSignal
        ? "performance signal confirmed by title"
        : "performance path signal",
    );
  }

  if (
    role === "source" &&
    (intersects(context.tokens, PUBLIC_BEHAVIOR_TOKENS) ||
      context.segments.includes("api"))
  ) {
    add(1, "public behavior signal");
  }

  switch (file.status) {
    case "added":
      add(1, "new file");
      break;
    case "modified":
    case "removed":
    case "renamed":
    default:
      break;
  }

  if (file.changes >= 1 && file.changes <= 20) add(1, "small focused diff");
  else if (file.changes <= 200) add(2, "substantial diff");
  else if (file.changes <= 800) add(1, "large diff");
  else add(-1, "very large diff");

  if (file.patch && file.patch.trim().length > 0) {
    add(1, "diff available");
  } else {
    reasons.push("no diff available (summary only)");
  }

  if (isInDirectory(context, ["fixtures", "fixture"])) {
    add(-2, "fixture support file");
  }

  return { score, reasons, role, contentPolicy, contentReason };
}

export function scoreFile(
  file: PullRequestFileData,
  context: FileScoreContext = {},
): number {
  return evaluateFile(file, buildPrKeywordContext(context)).score;
}

export function rankFilesByImportance(
  files: PullRequestFileData[],
  context: FileScoreContext = {},
): RankedPullRequestFile[] {
  const prKeywords = buildPrKeywordContext(context);

  return files
    .map((file, originalIndex) => ({
      file,
      originalIndex,
      ...evaluateFile(file, prKeywords),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.file.filename.localeCompare(b.file.filename) ||
        a.originalIndex - b.originalIndex,
    )
    .map(({ file, score, reasons, role, contentPolicy, contentReason }) => ({
      file,
      score,
      reasons,
      role,
      contentPolicy,
      contentReason,
    }));
}

// Les rôles préférés ne sont déduits que d'un scope Conventional Commits
// explicite (docs/test/ci/deps) : un simple "feat:"/"fix:"/"refactor:"/"perf:"
// est trop générique pour présumer que la PR touche au code, aux tests, à la
// CI ou à la doc — on laisse les correspondances titre/chemin trancher.
export function inferPreferredFileRoles(
  pullRequestTitle: string,
): PullRequestFileRole[] {
  const title = pullRequestTitle.trim().toLowerCase();
  const conventional = title.match(
    /^(feat|fix|docs|test|tests|ci|build|refactor|perf|chore)(?:\(([^)]+)\))?[!:]/,
  );
  const type = conventional?.[1];
  const scope = conventional?.[2] ?? "";
  const scopeTokens = scope.split(/[^a-z0-9]+/).filter(Boolean);

  if (scopeTokens.some((token) => ["deps", "dependencies"].includes(token))) {
    return ["dependency"];
  }
  if (
    scopeTokens.some((token) =>
      ["doc", "docs", "documentation"].includes(token),
    )
  ) {
    return ["documentation"];
  }
  if (scopeTokens.some((token) => ["test", "tests"].includes(token))) {
    return ["test"];
  }
  if (scopeTokens.some((token) => ["ci", "build"].includes(token))) {
    return ["ci-cd"];
  }

  if (type === "docs" || title.startsWith("documentation:")) {
    return ["documentation"];
  }
  if (type === "test" || type === "tests") return ["test"];
  if (type === "ci" || type === "build") return ["ci-cd"];
  if (
    title.startsWith("deps:") ||
    title.startsWith("dependencies:") ||
    title.includes("dependabot")
  ) {
    return ["dependency"];
  }

  return [];
}

function directoryGroup(filename: string): string {
  const parts = pathSegments(filename);
  if (parts.length <= 1) return "(root)";
  return parts.slice(0, Math.min(3, parts.length - 1)).join("/");
}

/**
 * Sélection gloutonne avec rendement décroissant par rôle et répertoire.
 * Seuls les fichiers "include-patch" avec un patch réel peuvent consommer une
 * place : un lockfile, un snapshot, un fichier généré ou un fichier source
 * sans diff disponible ne gaspillent jamais un emplacement de la sélection.
 */
export function selectRepresentativeFiles(
  rankedFiles: RankedPullRequestFile[],
  limit: number,
  preferredRoles: PullRequestFileRole[] = [],
): RankedPullRequestFile[] {
  const remaining = rankedFiles.filter(
    (ranked) =>
      ranked.contentPolicy === "include-patch" &&
      typeof ranked.file.patch === "string" &&
      ranked.file.patch.trim().length > 0,
  );
  const selected: RankedPullRequestFile[] = [];
  const roleCounts = new Map<PullRequestFileRole, number>();
  const directoryCounts = new Map<string, number>();

  while (selected.length < limit && remaining.length > 0) {
    let bestIndex = 0;
    let bestAdjustedScore = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const roleCount = roleCounts.get(candidate.role) ?? 0;
      const group = directoryGroup(candidate.file.filename);
      const directoryCount = directoryCounts.get(group) ?? 0;
      const adjustedScore =
        candidate.score -
        roleCount * 2 -
        directoryCount * 1 +
        (preferredRoles.includes(candidate.role) ? 3 : 0);

      if (adjustedScore > bestAdjustedScore) {
        bestAdjustedScore = adjustedScore;
        bestIndex = index;
      }
    }

    const [picked] = remaining.splice(bestIndex, 1);
    selected.push(picked);
    roleCounts.set(picked.role, (roleCounts.get(picked.role) ?? 0) + 1);
    const group = directoryGroup(picked.file.filename);
    directoryCounts.set(group, (directoryCounts.get(group) ?? 0) + 1);
  }

  return selected;
}

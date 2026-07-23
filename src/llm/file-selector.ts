import type {
  PullRequestFileData,
  PullRequestFileRole,
  RankedPullRequestFile,
} from "../domain/pull-request-data.js";

const IGNORED_BASENAMES = new Set([
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

const IGNORED_DIRECTORIES = [
  "dist",
  "coverage",
  ".next",
  "node_modules",
  ".cache",
  ".turbo",
];

const IGNORED_EXTENSIONS = [
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

const ROLE_BASE_SCORES: Record<PullRequestFileRole, number> = {
  source: 70,
  database: 68,
  "ci-cd": 64,
  dependency: 62,
  configuration: 55,
  documentation: 52,
  test: 50,
  other: 42,
  asset: 36,
  generated: -100,
};

function basename(filename: string): string {
  const parts = filename.split("/");
  return parts[parts.length - 1] ?? filename;
}

function pathSegments(filename: string): string[] {
  return filename.toLowerCase().split("/").filter(Boolean);
}

function hasPathSegment(filename: string, segments: string[]): boolean {
  const parts = pathSegments(filename);
  return segments.some((segment) => parts.includes(segment));
}

/**
 * Découpe un chemin sur la ponctuation et les frontières camelCase.
 * Les signaux sont ensuite comparés par mot entier : `authService` contient
 * bien `auth`, tandis que `author` ne déclenche pas un signal de sécurité.
 */
function tokenizePath(filename: string): Set<string> {
  const tokens = filename
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  return new Set(tokens);
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
    tokens: tokenizePath(filename),
  };
}

function hasAnyToken(context: FilePathContext, tokens: string[]): boolean {
  return tokens.some((token) => context.tokens.has(token));
}

function isInDirectory(
  context: FilePathContext,
  directories: string[],
): boolean {
  return directories.some((directory) => context.segments.includes(directory));
}

export function shouldIgnoreFile(filename: string): boolean {
  const lower = filename.toLowerCase();

  if (IGNORED_BASENAMES.has(basename(lower))) return true;
  if (hasPathSegment(lower, IGNORED_DIRECTORIES)) return true;
  if (IGNORED_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return true;
  }

  return false;
}

type RoleRule = {
  role: Exclude<PullRequestFileRole, "generated" | "other">;
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
    role: "dependency",
    matches: ({ base }) =>
      DEPENDENCY_MANIFESTS.has(base) ||
      base.startsWith("requirements-") ||
      base.startsWith("requirements."),
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
      isInDirectory(context, [
        "database",
        "db",
        "migration",
        "migrations",
        "schema",
        "schemas",
      ]) ||
      [".sql", ".prisma"].includes(context.extension) ||
      hasAnyToken(context, ["database", "migration", "prisma", "schema"]),
  },
  {
    role: "configuration",
    matches: ({ base, extension, segments }) =>
      ["config", "configs", "settings"].some((segment) =>
        segments.includes(segment),
      ) ||
      base.startsWith("config.") ||
      base.startsWith("settings.") ||
      base.startsWith(".env") ||
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

export function classifyFileRole(filename: string): PullRequestFileRole {
  if (shouldIgnoreFile(filename)) return "generated";

  const context = buildFilePathContext(filename);
  return ROLE_RULES.find((rule) => rule.matches(context))?.role ?? "other";
}

type Evaluation = {
  score: number;
  reasons: string[];
  ignored: boolean;
  role: PullRequestFileRole;
};

type ScoreSignalRule = {
  points: number;
  reason: string;
  matches: (context: FilePathContext, role: PullRequestFileRole) => boolean;
};

const SCORE_SIGNAL_RULES: ScoreSignalRule[] = [
  {
    points: 10,
    reason: "security signal",
    matches: (context) =>
      hasAnyToken(context, [
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
      ]),
  },
  {
    points: 8,
    reason: "performance signal",
    matches: (context) =>
      hasAnyToken(context, [
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
      ]),
  },
  {
    points: 5,
    reason: "public behavior signal",
    matches: (context, role) =>
      role === "source" &&
      (hasAnyToken(context, ["controller", "service", "router", "endpoint"]) ||
        context.segments.includes("api")),
  },
];

function evaluateFile(file: PullRequestFileData): Evaluation {
  const context = buildFilePathContext(file.filename);
  const role = classifyFileRole(file.filename);
  const ignored = role === "generated";

  if (ignored) {
    return {
      score: ROLE_BASE_SCORES.generated,
      reasons: ["generated or binary file"],
      ignored: true,
      role,
    };
  }

  const reasons = [`${role} role`];
  let score = ROLE_BASE_SCORES[role];

  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(reason);
  };

  for (const rule of SCORE_SIGNAL_RULES) {
    if (rule.matches(context, role)) add(rule.points, rule.reason);
  }

  switch (file.status) {
    case "added":
      add(5, "new file");
      break;
    case "removed":
      add(3, "removed file");
      break;
    case "modified":
      add(2, "modified file");
      break;
    case "renamed":
      add(2, "renamed file");
      break;
    default:
      break;
  }

  if (file.changes >= 1 && file.changes <= 20) add(2, "small focused diff");
  else if (file.changes <= 200) add(5, "substantial diff");
  else if (file.changes <= 800) add(3, "large diff");
  else add(-2, "very large diff");

  if (file.patch) add(4, "diff available");
  else if (file.status !== "removed") add(-6, "diff unavailable");

  if (
    context.segments.includes("__snapshots__") ||
    context.path.endsWith(".snap")
  ) {
    add(-15, "snapshot support file");
  }

  if (isInDirectory(context, ["fixtures", "fixture"])) {
    add(-8, "fixture support file");
  }

  if (
    isInDirectory(context, ["generated", "gen", "__generated__"]) ||
    context.base.includes(".generated.") ||
    context.base.endsWith(".g.cs") ||
    context.base.endsWith(".pb.go")
  ) {
    add(-20, "generated-looking source");
  }

  return { score, reasons, ignored: false, role };
}

export function scoreFile(file: PullRequestFileData): number {
  return evaluateFile(file).score;
}

export function rankFilesByImportance(
  files: PullRequestFileData[],
): RankedPullRequestFile[] {
  return files
    .map((file, originalIndex) => ({
      file,
      originalIndex,
      ...evaluateFile(file),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.file.filename.localeCompare(b.file.filename) ||
        a.originalIndex - b.originalIndex,
    )
    .map(({ file, score, reasons, ignored, role }) => ({
      file,
      score,
      reasons,
      ignored,
      role,
    }));
}

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
  if (["feat", "fix", "refactor", "perf"].includes(type ?? "")) {
    return ["source", "database", "configuration"];
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
 * Elle garde les meilleurs fichiers, sans laisser une grande suite de tests,
 * snapshots ou fixtures évincer le code et la documentation représentatifs.
 */
export function selectRepresentativeFiles(
  rankedFiles: RankedPullRequestFile[],
  limit: number,
  preferredRoles: PullRequestFileRole[] = [],
): RankedPullRequestFile[] {
  const remaining = rankedFiles.filter((ranked) => !ranked.ignored);
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
        roleCount * 10 -
        directoryCount * 3 +
        (preferredRoles.includes(candidate.role) ? 20 : 0);

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

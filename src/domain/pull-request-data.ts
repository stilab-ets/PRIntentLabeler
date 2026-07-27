export type PullRequestFileData = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
};

export type PullRequestData = {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  author: string;
  baseBranch: string;
  headBranch: string;
  // SHA du dernier commit de la PR au moment de la lecture : sert à détecter
  // une analyse périmée (voir StoredAnalysisState) quand une action de Check
  // Run est déclenchée après un nouveau push.
  headSha: string;
  htmlUrl: string;
  additions: number;
  deletions: number;
  changedFilesCount: number;
  files: PullRequestFileData[];
  repositoryLabels: string[];
  repositoryLabelDescriptions?: Record<string, string>;
  pullRequestLabels: string[];
};

export type PullRequestFileRole =
  | "source"
  | "test"
  | "documentation"
  | "dependency"
  | "ci-cd"
  | "database"
  | "configuration"
  | "asset"
  | "other"
  | "generated";

// Politique d'envoi du contenu au LLM, distincte du rôle sémantique : un
// fichier peut être important pour comprendre l'intention (ex. lockfile)
// sans que son patch, souvent énorme ou sans valeur sémantique, soit envoyé.
export type FileContentPolicy = "include-patch" | "summary-only";

// Fichier auquel on a attribué un score d'importance pour la sélection LLM.
export type RankedPullRequestFile = {
  file: PullRequestFileData;
  score: number;
  reasons: string[];
  role: PullRequestFileRole;
  contentPolicy: FileContentPolicy;
  contentReason?: string;
};

// Résumé léger (sans patch) d'un fichier, utilisé dans le contexte global.
export type RankedFileSummary = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  score: number;
  role: PullRequestFileRole;
  contentPolicy: FileContentPolicy;
  contentReason?: string;
};

export type FileRoleSummary = {
  role: PullRequestFileRole;
  files: number;
  changes: number;
};

// Contexte compact et filtré, prêt à être envoyé au LLM.
export type PullRequestLlmContext = {
  repository: {
    owner: string;
    repo: string;
  };
  pullRequest: {
    number: number;
    title: string;
    body: string;
    author: string;
    baseBranch: string;
    headBranch: string;
    htmlUrl: string;
  };
  totals: {
    additions: number;
    deletions: number;
    changedFilesCount: number;
  };
  repositoryLabels: string[];
  repositoryLabelDescriptions: Record<string, string>;
  allFilesSummary: RankedFileSummary[];
  fileRoleSummary: FileRoleSummary[];
  selectedFiles: RankedPullRequestFile[];
  // Fichiers dont le patch n'est jamais envoyé (lockfile, snapshot, généré,
  // binaire...) : ils restent visibles comme signal dans le résumé global.
  summaryOnlyFilesCount: number;
  omittedFilesCount: number;
  selectedFilesCount: number;
  promptBudget: {
    contextLimitTokens: number;
    responseReserveTokens: number;
    nonPatchEstimatedTokens: number;
    availablePatchTokens: number;
    allocatedPatchTokens: number;
    finalPromptEstimatedTokens: number;
    files: {
      filename: string;
      naturalTokens: number;
      allocatedTokens: number;
      actualTokens: number;
      truncated: boolean;
    }[];
  };
};

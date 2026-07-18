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

// Fichier auquel on a attribué un score d'importance pour la sélection LLM.
export type RankedPullRequestFile = {
  file: PullRequestFileData;
  score: number;
  reasons: string[];
  ignored: boolean;
  role: PullRequestFileRole;
};

// Résumé léger (sans patch) d'un fichier, utilisé dans le contexte global.
export type RankedFileSummary = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  score: number;
  ignored: boolean;
  role: PullRequestFileRole;
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
  ignoredFilesCount: number;
  omittedFilesCount: number;
  selectedFilesCount: number;
};

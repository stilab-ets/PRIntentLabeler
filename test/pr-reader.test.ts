import { describe, it, expect, vi, beforeEach } from "vitest";
import { readPullRequestData } from "../src/github/pr-reader.js";

function createMockContext(overrides: Record<string, unknown> = {}) {
  return {
    payload: {
      pull_request: {
        number: 42,
        title: "Fix login bug",
        body: "Closes #1",
        user: { login: "mehdi" },
        base: { ref: "main" },
        head: { ref: "fix-login", sha: "sha-fix-login" },
        html_url: "https://github.com/org/repo/pull/42",
        additions: 25,
        deletions: 5,
        changed_files: 2,
      },
      repository: {
        owner: { login: "org" },
        name: "repo",
      },
      ...overrides,
    },
    octokit: {
      pulls: {
        listFiles: vi.fn().mockResolvedValue({
          data: [
            {
              filename: "src/auth/login.ts",
              status: "modified",
              additions: 20,
              deletions: 5,
              changes: 25,
              patch: "@@ -1,5 +1,5 @@\n-old\n+new",
            },
            {
              filename: "test/auth/login.test.ts",
              status: "added",
              additions: 5,
              deletions: 0,
              changes: 5,
            },
          ],
        }),
      },
      issues: {
        listLabelsForRepo: vi.fn().mockResolvedValue({
          data: [
            { name: "bug", description: "Something is not working" },
            { name: "feature", description: "New functionality" },
            { name: "tests", description: null },
          ],
        }),
        listLabelsOnIssue: vi.fn().mockResolvedValue({
          data: [{ name: "bug" }],
        }),
      },
    },
  };
}

describe("readPullRequestData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extrait correctement les métadonnées de base de la PR", async () => {
    const ctx = createMockContext();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await readPullRequestData(ctx as any);

    expect(result.owner).toBe("org");
    expect(result.repo).toBe("repo");
    expect(result.number).toBe(42);
    expect(result.title).toBe("Fix login bug");
    expect(result.author).toBe("mehdi");
    expect(result.baseBranch).toBe("main");
    expect(result.headBranch).toBe("fix-login");
    expect(result.headSha).toBe("sha-fix-login");
  });

  it("extrait correctement les fichiers modifiés", async () => {
    const ctx = createMockContext();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await readPullRequestData(ctx as any);

    expect(result.files).toHaveLength(2);
    expect(result.files[0].filename).toBe("src/auth/login.ts");
    expect(result.files[0].patch).toBeDefined();
    expect(result.files[1].filename).toBe("test/auth/login.test.ts");
  });

  it("extrait correctement les labels du repo", async () => {
    const ctx = createMockContext();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await readPullRequestData(ctx as any);

    expect(result.repositoryLabels).toEqual(["bug", "feature", "tests"]);
    expect(result.repositoryLabelDescriptions).toEqual({
      bug: "Something is not working",
      feature: "New functionality",
    });
  });

  it("extrait les labels actuellement présents sur la PR", async () => {
    const ctx = createMockContext();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await readPullRequestData(ctx as any);

    expect(result.pullRequestLabels).toEqual(["bug"]);
  });

  it("gère le cas où le body de la PR est null", async () => {
    const ctx = createMockContext({
      pull_request: {
        number: 1,
        title: "t",
        body: null,
        user: { login: "u" },
        base: { ref: "main" },
        head: { ref: "f" },
        html_url: "",
        additions: 0,
        deletions: 0,
        changed_files: 0,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await readPullRequestData(ctx as any);

    expect(result.body).toBe("");
  });

  it("gère le cas où l'auteur de la PR est inconnu", async () => {
    const ctx = createMockContext({
      pull_request: {
        number: 1,
        title: "t",
        body: "",
        user: null,
        base: { ref: "main" },
        head: { ref: "f" },
        html_url: "",
        additions: 0,
        deletions: 0,
        changed_files: 0,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await readPullRequestData(ctx as any);

    expect(result.author).toBe("unknown");
  });

  it("appelle Octokit avec les bonnes options de pagination", async () => {
    const ctx = createMockContext();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await readPullRequestData(ctx as any);

    expect(ctx.octokit.pulls.listFiles).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      pull_number: 42,
      per_page: 100,
    });
    expect(ctx.octokit.issues.listLabelsForRepo).toHaveBeenCalledWith({
      owner: "org",
      repo: "repo",
      per_page: 100,
    });
  });
});

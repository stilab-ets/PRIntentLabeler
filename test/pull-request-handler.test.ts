import { describe, it, expect, vi, beforeEach } from "vitest";
import { handlePullRequestEvent } from "../src/handlers/pull-request-handler.js";

function createMockContext(throwOnReader = false) {
  return {
    payload: {
      action: "opened",
      pull_request: {
        number: 1,
        title: "Test PR",
        body: "",
        user: { login: "test-user" },
        base: { ref: "main" },
        head: { ref: "feature", sha: "sha-feature" },
        html_url: "",
        additions: 1,
        deletions: 0,
        changed_files: 1,
      },
      repository: {
        owner: { login: "org" },
        name: "repo",
      },
    },
    octokit: {
      pulls: {
        listFiles: throwOnReader
          ? vi.fn().mockRejectedValue(new Error("Network error"))
          : vi.fn().mockResolvedValue({
              data: [
                {
                  filename: "src/a.ts",
                  status: "modified",
                  additions: 1,
                  deletions: 0,
                  changes: 1,
                },
              ],
            }),
      },
      issues: {
        listLabelsForRepo: vi
          .fn()
          .mockResolvedValue({ data: [{ name: "bug" }] }),
        listLabelsOnIssue: vi.fn().mockResolvedValue({ data: [] }),
        listComments: vi.fn().mockResolvedValue({ data: [] }),
        createComment: vi.fn().mockResolvedValue({}),
        updateComment: vi.fn().mockResolvedValue({}),
      },
    },
    log: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  };
}

describe("handlePullRequestEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("orchestre la lecture de la PR puis la création du commentaire", async () => {
    const ctx = createMockContext();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePullRequestEvent(ctx as any);

    expect(ctx.octokit.pulls.listFiles).toHaveBeenCalled();
    expect(ctx.octokit.issues.listLabelsForRepo).toHaveBeenCalled();
    expect(ctx.octokit.issues.createComment).toHaveBeenCalled();
  });

  it("log un succès quand tout se passe bien", async () => {
    const ctx = createMockContext();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePullRequestEvent(ctx as any);

    expect(ctx.log.info).toHaveBeenCalledWith(
      expect.any(Object),
      "Pull request analysis comment published",
    );
  });

  it("capture les erreurs sans re-thrower (évite les retries GitHub)", async () => {
    const ctx = createMockContext(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(handlePullRequestEvent(ctx as any)).resolves.not.toThrow();

    expect(ctx.log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.any(String),
      }),
      "Failed to process pull request event",
    );
  });

  it("log le contexte complet de l'événement au démarrage", async () => {
    const ctx = createMockContext();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePullRequestEvent(ctx as any);

    expect(ctx.log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "opened",
        owner: "org",
        repo: "repo",
        pullNumber: 1,
      }),
      "Processing pull request event",
    );
  });
});

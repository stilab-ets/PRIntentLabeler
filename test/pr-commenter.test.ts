import { describe, it, expect, vi, beforeEach } from "vitest";
import { upsertPullRequestComment } from "../src/github/pr-commenter.js";
import { BOT_COMMENT_MARKER } from "../src/utils/constants.js";

type MockComment = {
  id: number;
  body: string;
  user?: { type: string };
  performed_via_github_app?: { id: number };
};

function appComment(id: number, body: string): MockComment {
  return {
    id,
    body,
    user: { type: "Bot" },
    performed_via_github_app: { id: 77 },
  };
}

function createMockContext(existingComments: MockComment[] = []) {
  return {
    payload: {
      repository: {
        owner: { login: "test-owner" },
        name: "test-repo",
      },
    },
    octokit: {
      issues: {
        listComments: vi.fn().mockResolvedValue({ data: existingComments }),
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

describe("upsertPullRequestComment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_ID = "77";
  });

  it("crée un nouveau commentaire si aucun commentaire bot n'existe", async () => {
    const ctx = createMockContext([]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await upsertPullRequestComment(ctx as any, 42, "test body");

    expect(ctx.octokit.issues.createComment).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 42,
      body: "test body",
    });
    expect(ctx.octokit.issues.updateComment).not.toHaveBeenCalled();
  });

  it("met à jour le commentaire bot existant via le marker", async () => {
    const ctx = createMockContext([
      appComment(123, `${BOT_COMMENT_MARKER}\nold content`),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await upsertPullRequestComment(ctx as any, 42, "new body");

    expect(ctx.octokit.issues.updateComment).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      comment_id: 123,
      body: "new body",
    });
    expect(ctx.octokit.issues.createComment).not.toHaveBeenCalled();
  });

  it("ignore les commentaires d'autres utilisateurs", async () => {
    const ctx = createMockContext([
      { id: 999, body: "some user comment without marker" },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await upsertPullRequestComment(ctx as any, 42, "test");

    expect(ctx.octokit.issues.createComment).toHaveBeenCalled();
    expect(ctx.octokit.issues.updateComment).not.toHaveBeenCalled();
  });

  it("identifie correctement le commentaire bot parmi plusieurs commentaires", async () => {
    const ctx = createMockContext([
      { id: 1, body: "first user comment" },
      appComment(2, `${BOT_COMMENT_MARKER}\nbot content here`),
      { id: 3, body: "another user comment" },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await upsertPullRequestComment(ctx as any, 42, "updated body");

    expect(ctx.octokit.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 2 }),
    );
  });

  it("appelle listComments avec la bonne pagination", async () => {
    const ctx = createMockContext([]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await upsertPullRequestComment(ctx as any, 42, "test");

    expect(ctx.octokit.issues.listComments).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 42,
      per_page: 100,
    });
  });

  it("ignore un marker copié par un commentaire humain", async () => {
    const ctx = createMockContext([
      {
        id: 8,
        body: `${BOT_COMMENT_MARKER}\nforged`,
        user: { type: "User" },
      },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await upsertPullRequestComment(ctx as any, 42, "new body");

    expect(ctx.octokit.issues.createComment).toHaveBeenCalled();
    expect(ctx.octokit.issues.updateComment).not.toHaveBeenCalled();
  });
});

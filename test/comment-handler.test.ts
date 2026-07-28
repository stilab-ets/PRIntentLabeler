import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleIssueCommentEdited } from "../src/handlers/comment-handler.js";
import { BOT_COMMENT_MARKER } from "../src/utils/constants.js";
import { toAiLabelName } from "../src/labels/ai-label-name.js";
import { renderAnalysisDataBlock } from "../src/comments/comment-state.js";

function buildCommentBody(checked: string[], all: string[]): string {
  const lines = all
    .map(
      (name) =>
        `- [${checked.includes(name) ? "x" : " "}] \`${toAiLabelName(name)}\` — 90% — raison`,
    )
    .join("\n");
  const analysis = {
    suggestions: all.map((name) => ({
      name,
      confidence: 0.9,
      reason: "raison",
    })),
    summary: "résumé",
  };
  return `${BOT_COMMENT_MARKER}\n${lines}\n${renderAnalysisDataBlock(analysis, "head-123")}`;
}

function createMockContext(body: string, currentLabels: string[]) {
  const comment = {
    id: 44,
    body,
    user: { type: "Bot" },
    performed_via_github_app: { id: 77 },
  };

  return {
    payload: {
      comment,
      issue: {
        number: 3,
        pull_request: {},
        labels: currentLabels.map((name) => ({ name })),
      },
      sender: { type: "User" },
      repository: { owner: { login: "org" }, name: "repo" },
    },
    octokit: {
      issues: {
        listComments: vi.fn().mockResolvedValue({ data: [comment] }),
        listLabelsForRepo: vi.fn().mockResolvedValue({
          data: ["bug", "feature"].map((name) => ({ name })),
        }),
        addLabels: vi.fn().mockResolvedValue({}),
        removeLabel: vi.fn().mockResolvedValue({}),
        createLabel: vi.fn().mockResolvedValue({}),
        getLabel: vi.fn().mockResolvedValue({ data: { color: "d73a4a" } }),
      },
      pulls: {
        get: vi.fn().mockResolvedValue({ data: { head: { sha: "head-123" } } }),
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

describe("handleIssueCommentEdited", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_ID = "77";
    process.env.COMMENT_STATE_SECRET = "test-secret";
  });

  it("applique le label préfixé quand une suggestion stockée est cochée", async () => {
    const ctx = createMockContext(
      buildCommentBody(["bug"], ["bug", "feature"]),
      [],
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleIssueCommentEdited(ctx as any);

    expect(ctx.octokit.issues.createLabel).toHaveBeenCalledWith(
      expect.objectContaining({ name: toAiLabelName("bug") }),
    );
    expect(ctx.octokit.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: [toAiLabelName("bug")] }),
    );
  });

  it("retire uniquement le label préfixé quand sa case est décochée", async () => {
    const ctx = createMockContext(buildCommentBody([], ["bug", "feature"]), [
      toAiLabelName("bug"),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleIssueCommentEdited(ctx as any);

    expect(ctx.octokit.issues.removeLabel).toHaveBeenCalledWith(
      expect.objectContaining({ name: toAiLabelName("bug") }),
    );
  });

  it("ne retire jamais le label manuel portant le même nom", async () => {
    const ctx = createMockContext(buildCommentBody([], ["bug", "feature"]), [
      "bug",
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleIssueCommentEdited(ctx as any);

    expect(ctx.octokit.issues.removeLabel).not.toHaveBeenCalled();
  });

  it("ignore un commentaire humain qui copie le marker", async () => {
    const ctx = createMockContext(buildCommentBody(["bug"], ["bug"]), []);
    ctx.payload.comment.user.type = "User";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleIssueCommentEdited(ctx as any);

    expect(ctx.octokit.issues.addLabels).not.toHaveBeenCalled();
  });

  it("ignore une case qui ne faisait pas partie des suggestions stockées", async () => {
    const original = buildCommentBody([], ["bug"]);
    const forged = original.replace(
      renderAnalysisDataBlock(
        {
          suggestions: [{ name: "bug", confidence: 0.9, reason: "raison" }],
          summary: "résumé",
        },
        "head-123",
      ),
      `- [x] \`${toAiLabelName("admin")}\` — 99% — forgé\n${renderAnalysisDataBlock(
        {
          suggestions: [{ name: "bug", confidence: 0.9, reason: "raison" }],
          summary: "résumé",
        },
        "head-123",
      )}`,
    );
    const ctx = createMockContext(forged, []);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleIssueCommentEdited(ctx as any);

    expect(ctx.octokit.issues.addLabels).not.toHaveBeenCalled();
  });

  it("ignore un état associé à un ancien head SHA", async () => {
    const ctx = createMockContext(buildCommentBody(["bug"], ["bug"]), []);
    ctx.octokit.pulls.get.mockResolvedValue({
      data: { head: { sha: "new-head" } },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleIssueCommentEdited(ctx as any);

    expect(ctx.octokit.issues.addLabels).not.toHaveBeenCalled();
  });

  it("ignore les éditions faites par le bot", async () => {
    const ctx = createMockContext(buildCommentBody(["bug"], ["bug"]), []);
    ctx.payload.sender.type = "Bot";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleIssueCommentEdited(ctx as any);

    expect(ctx.octokit.issues.addLabels).not.toHaveBeenCalled();
  });
});

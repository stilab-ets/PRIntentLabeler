import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleCheckRunRequestedAction } from "../src/handlers/check-run-handler.js";
import { renderAnalysisDataBlock } from "../src/comments/comment-state.js";
import { BOT_COMMENT_MARKER } from "../src/utils/constants.js";
import { toAiLabelName } from "../src/labels/ai-label-name.js";
import {
  ACTION_SUGGEST,
  ACTION_APPLY_HIGH,
  ACTION_APPLY_ALL,
} from "../src/github/check-run.js";

const analysis = {
  suggestions: [
    { name: "feature", confidence: 0.95, reason: "nouvel endpoint" },
    { name: "bug", confidence: 0.72, reason: "corrige un cas limite" },
  ],
  summary: "Ajoute l'authentification JWT.",
};

function createMockContext(identifier: string, currentLabels: string[] = []) {
  const commentBody = `${BOT_COMMENT_MARKER}\n${renderAnalysisDataBlock(analysis)}`;

  return {
    payload: {
      requested_action: { identifier },
      check_run: {
        pull_requests: [{ number: 5 }],
      },
      repository: { owner: { login: "org" }, name: "repo" },
    },
    octokit: {
      pulls: {
        get: vi.fn().mockResolvedValue({
          data: {
            title: "Add JWT auth",
            body: "",
            user: { login: "talip" },
            base: { ref: "main" },
            head: { ref: "feat/jwt" },
            html_url: "",
            additions: 30,
            deletions: 2,
            changed_files: 1,
          },
        }),
        listFiles: vi.fn().mockResolvedValue({
          data: [
            {
              filename: "src/auth/jwt.ts",
              status: "added",
              additions: 30,
              deletions: 0,
              changes: 30,
            },
          ],
        }),
      },
      issues: {
        listLabelsForRepo: vi
          .fn()
          .mockResolvedValue({ data: [{ name: "feature" }, { name: "bug" }] }),
        listLabelsOnIssue: vi
          .fn()
          .mockResolvedValue({ data: currentLabels.map((name) => ({ name })) }),
        listComments: vi
          .fn()
          .mockResolvedValue({ data: [{ id: 1, body: commentBody }] }),
        updateComment: vi.fn().mockResolvedValue({}),
        createComment: vi.fn().mockResolvedValue({}),
        addLabels: vi.fn().mockResolvedValue({}),
        removeLabel: vi.fn().mockResolvedValue({}),
        createLabel: vi.fn().mockResolvedValue({}),
        getLabel: vi.fn().mockResolvedValue({ data: { color: "d73a4a" } }),
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

describe("handleCheckRunRequestedAction — labels préfixés par l'icône IA", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Auto-apply all applique les labels sous leur forme préfixée 🤖", async () => {
    const ctx = createMockContext(ACTION_APPLY_ALL, []);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleCheckRunRequestedAction(ctx as any);

    expect(ctx.octokit.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: [toAiLabelName("feature"), toAiLabelName("bug")],
      }),
    );
  });

  it("Auto-apply high applique le label >= seuil et retire l'ancien label sous le seuil", async () => {
    const ctx = createMockContext(ACTION_APPLY_HIGH, ["bug"]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleCheckRunRequestedAction(ctx as any);

    expect(ctx.octokit.issues.removeLabel).toHaveBeenCalledWith(
      expect.objectContaining({ name: "bug" }),
    );
    expect(ctx.octokit.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: [toAiLabelName("feature")] }),
    );
  });

  it("Suggest only précoche les cases dont la variante 🤖 est déjà sur la PR", async () => {
    const ctx = createMockContext(ACTION_SUGGEST, [toAiLabelName("bug")]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleCheckRunRequestedAction(ctx as any);

    expect(ctx.octokit.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining(`- [x] \`${toAiLabelName("bug")}\``),
      }),
    );
    expect(ctx.octokit.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining(`- [ ] \`${toAiLabelName("feature")}\``),
      }),
    );
    expect(ctx.octokit.issues.addLabels).not.toHaveBeenCalled();
  });

  it("ne touche jamais un label identique posé manuellement (sans le préfixe 🤖)", async () => {
    // "bug" est présent sans préfixe : ce n'est pas le fait de notre bot.
    const ctx = createMockContext(ACTION_SUGGEST, ["bug"]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleCheckRunRequestedAction(ctx as any);

    expect(ctx.octokit.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining(`- [ ] \`${toAiLabelName("bug")}\``),
      }),
    );
  });
});

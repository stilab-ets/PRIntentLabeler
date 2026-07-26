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

const CURRENT_HEAD_SHA = "sha-current";

function createMockContext(
  identifier: string,
  currentLabels: string[] = [],
  options: {
    commentBody?: string;
    checkRunHeadSha?: string;
    prHeadSha?: string;
  } = {},
) {
  const commentBody =
    options.commentBody ??
    `${BOT_COMMENT_MARKER}\n${renderAnalysisDataBlock(analysis, CURRENT_HEAD_SHA)}`;

  return {
    payload: {
      requested_action: { identifier },
      check_run: {
        head_sha: options.checkRunHeadSha ?? CURRENT_HEAD_SHA,
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
            head: { ref: "feat/jwt", sha: options.prHeadSha ?? CURRENT_HEAD_SHA },
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

describe("handleCheckRunRequestedAction — protection contre une analyse périmée", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("SHA identique (Check Run + PR actuelle) : l'action est autorisée", async () => {
    const ctx = createMockContext(ACTION_APPLY_ALL, [], {
      checkRunHeadSha: "sha-1",
      prHeadSha: "sha-1",
      commentBody: `${BOT_COMMENT_MARKER}\n${renderAnalysisDataBlock(analysis, "sha-1")}`,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleCheckRunRequestedAction(ctx as any);

    expect(ctx.octokit.issues.addLabels).toHaveBeenCalled();
  });

  it("SHA différent (nouveau push depuis l'analyse) : aucun label appliqué ni retiré", async () => {
    const ctx = createMockContext(ACTION_APPLY_ALL, ["bug"], {
      checkRunHeadSha: "sha-old",
      prHeadSha: "sha-new",
      commentBody: `${BOT_COMMENT_MARKER}\n${renderAnalysisDataBlock(analysis, "sha-old")}`,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleCheckRunRequestedAction(ctx as any);

    expect(ctx.octokit.issues.addLabels).not.toHaveBeenCalled();
    expect(ctx.octokit.issues.removeLabel).not.toHaveBeenCalled();
    expect(ctx.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ storedHeadSha: "sha-old" }),
      expect.stringContaining("stale"),
    );
  });

  it("ancien bloc de données sans headSha (v1) : aucun crash, action refusée", async () => {
    // Simule un ancien commentaire : le blob base64 est directement {suggestions, summary}.
    const legacyBlock = `<!-- llm-pr-labeler:data ${Buffer.from(
      JSON.stringify(analysis),
      "utf8",
    ).toString("base64")} -->`;
    const ctx = createMockContext(ACTION_APPLY_ALL, [], {
      commentBody: `${BOT_COMMENT_MARKER}\n${legacyBlock}`,
    });

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handleCheckRunRequestedAction(ctx as any),
    ).resolves.not.toThrow();

    expect(ctx.octokit.issues.addLabels).not.toHaveBeenCalled();
  });

  it("identifiant d'action inconnu : aucun changement, même avec un SHA valide", async () => {
    const ctx = createMockContext("unknown-action", []);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleCheckRunRequestedAction(ctx as any);

    expect(ctx.octokit.issues.addLabels).not.toHaveBeenCalled();
    expect(ctx.octokit.issues.removeLabel).not.toHaveBeenCalled();
    expect(ctx.octokit.issues.updateComment).not.toHaveBeenCalled();
  });
});

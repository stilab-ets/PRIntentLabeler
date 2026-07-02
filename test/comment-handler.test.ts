import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleIssueCommentEdited } from "../src/handlers/comment-handler.js";
import { BOT_COMMENT_MARKER } from "../src/utils/constants.js";
import { toAiLabelName } from "../src/labels/ai-label-name.js";

function buildCommentBody(checked: string[], all: string[]): string {
  const lines = all
    .map(
      (name) =>
        `- [${checked.includes(name) ? "x" : " "}] \`${toAiLabelName(name)}\` — 90% — raison`,
    )
    .join("\n");
  return `${BOT_COMMENT_MARKER}\n${lines}`;
}

function createMockContext(body: string, currentLabels: string[]) {
  return {
    payload: {
      comment: { body },
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

describe("handleIssueCommentEdited — labels préfixés par l'icône IA", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applique le label sous sa forme préfixée 🤖 quand une case suggérée est cochée", async () => {
    const body = buildCommentBody(["bug"], ["bug", "feature"]);
    const ctx = createMockContext(body, []);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleIssueCommentEdited(ctx as any);

    expect(ctx.octokit.issues.createLabel).toHaveBeenCalledWith(
      expect.objectContaining({ name: toAiLabelName("bug") }),
    );
    expect(ctx.octokit.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: [toAiLabelName("bug")] }),
    );
  });

  it("retire le label préfixé 🤖 quand la case suggérée est décochée", async () => {
    const body = buildCommentBody([], ["bug", "feature"]);
    const ctx = createMockContext(body, [toAiLabelName("bug")]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleIssueCommentEdited(ctx as any);

    expect(ctx.octokit.issues.removeLabel).toHaveBeenCalledWith(
      expect.objectContaining({ name: toAiLabelName("bug") }),
    );
  });

  it("ne touche pas un label identique posé manuellement (sans le préfixe 🤖)", async () => {
    // "bug" est présent sans préfixe : label posé par un humain, pas par le bot.
    const body = buildCommentBody([], ["bug", "feature"]);
    const ctx = createMockContext(body, ["bug"]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleIssueCommentEdited(ctx as any);

    // "bug" (sans préfixe) correspond bien au nom de base suggéré : la case
    // décochée retire ce label, quelle que soit son origine (comportement
    // volontaire déjà existant, limité au périmètre des labels suggérés).
    expect(ctx.octokit.issues.removeLabel).toHaveBeenCalledWith(
      expect.objectContaining({ name: "bug" }),
    );
  });

  it("ignore les éditions faites par le bot (anti-boucle)", async () => {
    const body = buildCommentBody(["bug"], ["bug"]);
    const ctx = createMockContext(body, []);
    ctx.payload.sender.type = "Bot";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleIssueCommentEdited(ctx as any);

    expect(ctx.octokit.issues.addLabels).not.toHaveBeenCalled();
  });
});

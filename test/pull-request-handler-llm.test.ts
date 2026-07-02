import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handlePullRequestEvent } from "../src/handlers/pull-request-handler.js";
import type { LlmProvider } from "../src/llm/llm-provider.js";
import { toAiLabelName } from "../src/labels/ai-label-name.js";

function createMockContext() {
  return {
    payload: {
      action: "opened",
      pull_request: {
        number: 7,
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
      repository: { owner: { login: "org" }, name: "repo" },
    },
    octokit: {
      pulls: {
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
        listLabelsOnIssue: vi.fn().mockResolvedValue({ data: [] }),
        listComments: vi.fn().mockResolvedValue({ data: [] }),
        createComment: vi.fn().mockResolvedValue({}),
        updateComment: vi.fn().mockResolvedValue({}),
        addLabels: vi.fn().mockResolvedValue({}),
        removeLabel: vi.fn().mockResolvedValue({}),
        createLabel: vi.fn().mockResolvedValue({}),
        getLabel: vi.fn().mockResolvedValue({ data: { color: "d73a4a" } }),
      },
      checks: {
        create: vi.fn().mockResolvedValue({}),
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

function mockProvider(): LlmProvider {
  return {
    classifyPullRequest: vi.fn().mockResolvedValue({
      suggestions: [
        { name: "feature", confidence: 0.95, reason: "nouvel endpoint" },
        { name: "bug", confidence: 0.72, reason: "corrige un cas limite" },
      ],
      summary: "Ajoute l'authentification JWT.",
    }),
  };
}

describe("handlePullRequestEvent — chemin LLM", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LABEL_MODE;
  });

  afterEach(() => {
    delete process.env.LABEL_MODE;
  });

  it("mode suggest : commente sans appliquer de label", async () => {
    process.env.LABEL_MODE = "suggest";
    const ctx = createMockContext();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePullRequestEvent(ctx as any, mockProvider());

    expect(ctx.octokit.issues.createComment).toHaveBeenCalled();
    expect(ctx.octokit.issues.addLabels).not.toHaveBeenCalled();
  });

  it("mode auto-high : applique les labels au-dessus du seuil et retire les autres suggérés", async () => {
    process.env.LABEL_MODE = "auto-high";
    const ctx = createMockContext();
    ctx.octokit.issues.listLabelsOnIssue = vi
      .fn()
      .mockResolvedValue({ data: [{ name: "bug" }] });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePullRequestEvent(ctx as any, mockProvider());

    expect(ctx.octokit.issues.removeLabel).toHaveBeenCalledWith(
      expect.objectContaining({ name: "bug" }),
    );
    expect(ctx.octokit.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: [toAiLabelName("feature")] }),
    );
  });

  it("mode auto-all : applique tous les labels retenus, préfixés par l'icône IA", async () => {
    process.env.LABEL_MODE = "auto-all";
    const ctx = createMockContext();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePullRequestEvent(ctx as any, mockProvider());

    expect(ctx.octokit.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: [toAiLabelName("feature"), toAiLabelName("bug")],
      }),
    );
  });

  it("mode suggest : ne crée ni n'applique aucun label", async () => {
    process.env.LABEL_MODE = "suggest";
    const ctx = createMockContext();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handlePullRequestEvent(ctx as any, mockProvider());

    expect(ctx.octokit.issues.addLabels).not.toHaveBeenCalled();
    expect(ctx.octokit.issues.createLabel).not.toHaveBeenCalled();
  });

  it("ne plante pas si l'application des labels échoue", async () => {
    process.env.LABEL_MODE = "auto-all";
    const ctx = createMockContext();
    ctx.octokit.issues.addLabels = vi
      .fn()
      .mockRejectedValue(new Error("403 Forbidden"));

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handlePullRequestEvent(ctx as any, mockProvider()),
    ).resolves.not.toThrow();

    expect(ctx.octokit.issues.createComment).toHaveBeenCalled();
  });
});

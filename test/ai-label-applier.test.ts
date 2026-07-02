import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyAiSuggestedLabels } from "../src/labels/ai-label-applier.js";
import { AI_LABEL_FALLBACK_COLOR } from "../src/utils/constants.js";

function createOctokit() {
  return {
    issues: {
      getLabel: vi.fn().mockResolvedValue({ data: { color: "d73a4a" } }),
      createLabel: vi.fn().mockResolvedValue({}),
      addLabels: vi.fn().mockResolvedValue({}),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("applyAiSuggestedLabels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("crée la variante préfixée en reprenant la couleur du label d'origine", async () => {
    const octokit = createOctokit();
    await applyAiSuggestedLabels(octokit, "org", "repo", 1, ["bug"]);

    expect(octokit.issues.getLabel).toHaveBeenCalledWith(
      expect.objectContaining({ name: "bug" }),
    );
    expect(octokit.issues.createLabel).toHaveBeenCalledWith(
      expect.objectContaining({ name: "🤖 bug", color: "d73a4a" }),
    );
    expect(octokit.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ["🤖 bug"] }),
    );
  });

  it("utilise une couleur de repli si le label d'origine est introuvable", async () => {
    const octokit = createOctokit();
    octokit.issues.getLabel = vi.fn().mockRejectedValue(new Error("404"));

    await applyAiSuggestedLabels(octokit, "org", "repo", 1, ["nouveau"]);

    expect(octokit.issues.createLabel).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "🤖 nouveau",
        color: AI_LABEL_FALLBACK_COLOR,
      }),
    );
  });

  it("ignore l'erreur 422 (label déjà existant)", async () => {
    const octokit = createOctokit();
    octokit.issues.createLabel = vi.fn().mockRejectedValue({ status: 422 });

    await expect(
      applyAiSuggestedLabels(octokit, "org", "repo", 1, ["bug"]),
    ).resolves.not.toThrow();

    expect(octokit.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ["🤖 bug"] }),
    );
  });

  it("applique plusieurs labels en une seule fois", async () => {
    const octokit = createOctokit();
    await applyAiSuggestedLabels(octokit, "org", "repo", 1, [
      "bug",
      "feature",
    ]);

    expect(octokit.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ["🤖 bug", "🤖 feature"] }),
    );
  });

  it("ne fait rien si la liste est vide", async () => {
    const octokit = createOctokit();
    await applyAiSuggestedLabels(octokit, "org", "repo", 1, []);

    expect(octokit.issues.createLabel).not.toHaveBeenCalled();
    expect(octokit.issues.addLabels).not.toHaveBeenCalled();
  });
});

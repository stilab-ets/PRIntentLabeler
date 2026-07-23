import { describe, expect, it } from "vitest";
import { renderSettingsPage } from "../src/http/settings-page.js";

describe("renderSettingsPage", () => {
  it("masque la clé actuelle et échappe les valeurs dynamiques", () => {
    const html = renderSettingsPage({
      installationId: 42,
      session: {
        githubUserId: 7,
        githubLogin: "<talip>",
        installationIds: [42],
        csrfToken: "csrf-token",
        expiresAt: new Date(),
      },
      configuration: {
        installationId: 42,
        provider: "openai",
        model: "gpt-test",
        keyLastFour: "1234",
        updatedByGithubUserId: 7,
        updatedAt: new Date("2026-07-23T12:00:00Z"),
      },
    });

    expect(html).toContain("&lt;talip&gt;");
    expect(html).toContain("terminant par <code>1234</code>");
    expect(html).not.toContain("sk-secret");
    expect(html).toContain("Laisser vide pour conserver la clé actuelle");
  });
});

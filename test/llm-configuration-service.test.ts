import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  SaveLlmConfiguration,
  StoredLlmConfiguration,
} from "../src/configuration/llm-configuration.js";
import type { LlmConfigurationRepository } from "../src/configuration/llm-configuration-repository.js";
import { LlmConfigurationService } from "../src/configuration/llm-configuration-service.js";
import { ApiKeyCipher } from "../src/security/api-key-cipher.js";

class InMemoryRepository implements LlmConfigurationRepository {
  configuration: StoredLlmConfiguration | null = null;

  async findByInstallationId(
    installationId: number,
  ): Promise<StoredLlmConfiguration | null> {
    return this.configuration?.installationId === installationId
      ? this.configuration
      : null;
  }

  async upsert(input: SaveLlmConfiguration): Promise<StoredLlmConfiguration> {
    const now = new Date();
    this.configuration = {
      ...input,
      createdAt: this.configuration?.createdAt ?? now,
      updatedAt: now,
    };
    return this.configuration;
  }

  async delete(installationId: number): Promise<boolean> {
    if (this.configuration?.installationId !== installationId) return false;
    this.configuration = null;
    return true;
  }
}

function successfulFetch() {
  return vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "OK" } }],
      }),
      { status: 200 },
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LlmConfigurationService", () => {
  it("teste, chiffre et résout une nouvelle configuration", async () => {
    vi.stubGlobal("fetch", successfulFetch());
    const repository = new InMemoryRepository();
    const service = new LlmConfigurationService(
      repository,
      new ApiKeyCipher(Buffer.alloc(32, 3).toString("base64")),
    );

    const summary = await service.save({
      installationId: 42,
      provider: "groq",
      model: "llama-test",
      apiKey: "gsk-secret-1234",
      githubUserId: 7,
    });

    expect(summary.keyLastFour).toBe("1234");
    expect(repository.configuration?.encryptedApiKey.ciphertext).not.toContain(
      "gsk-secret-1234",
    );
    await expect(service.resolve(42)).resolves.toEqual({
      installationId: 42,
      provider: "groq",
      model: "llama-test",
      apiKey: "gsk-secret-1234",
      baseUrl: undefined,
    });
  });

  it("conserve la clé actuelle quand seul le modèle change", async () => {
    vi.stubGlobal("fetch", successfulFetch());
    const repository = new InMemoryRepository();
    const service = new LlmConfigurationService(
      repository,
      new ApiKeyCipher(Buffer.alloc(32, 4).toString("base64")),
    );

    await service.save({
      installationId: 42,
      provider: "groq",
      model: "old-model",
      apiKey: "gsk-secret-1234",
      githubUserId: 7,
    });
    await service.save({
      installationId: 42,
      provider: "groq",
      model: "new-model",
      githubUserId: 7,
    });

    expect((await service.resolve(42))?.apiKey).toBe("gsk-secret-1234");
    expect((await service.resolve(42))?.model).toBe("new-model");
  });

  it("conserve l’ancienne configuration si la nouvelle clé échoue", async () => {
    const fetchMock = successfulFetch();
    vi.stubGlobal("fetch", fetchMock);
    const repository = new InMemoryRepository();
    const service = new LlmConfigurationService(
      repository,
      new ApiKeyCipher(Buffer.alloc(32, 5).toString("base64")),
    );

    await service.save({
      installationId: 42,
      provider: "groq",
      model: "working-model",
      apiKey: "working-key-1111",
      githubUserId: 7,
    });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "Invalid API key" } }), {
        status: 401,
      }),
    );

    await expect(
      service.save({
        installationId: 42,
        provider: "groq",
        model: "new-model",
        apiKey: "invalid-key-2222",
        githubUserId: 7,
      }),
    ).rejects.toThrow("(401)");

    expect((await service.resolve(42))?.apiKey).toBe("working-key-1111");
    expect((await service.resolve(42))?.model).toBe("working-model");
  });

  it("demande une nouvelle clé lors d’un changement de fournisseur", async () => {
    vi.stubGlobal("fetch", successfulFetch());
    const repository = new InMemoryRepository();
    const service = new LlmConfigurationService(
      repository,
      new ApiKeyCipher(Buffer.alloc(32, 6).toString("base64")),
    );

    await service.save({
      installationId: 42,
      provider: "groq",
      model: "llama-test",
      apiKey: "groq-key",
      githubUserId: 7,
    });

    await expect(
      service.save({
        installationId: 42,
        provider: "anthropic",
        model: "claude-test",
        githubUserId: 7,
      }),
    ).rejects.toThrow("nouvelle clé API");
  });
});

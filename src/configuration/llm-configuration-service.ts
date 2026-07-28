import { createLlmProvider } from "../llm/provider-factory.js";
import {
  getLlmProviderDefinition,
  normalizeProviderBaseUrl,
} from "../llm/provider-configuration.js";
import { ApiKeyCipher, getApiKeySuffix } from "../security/api-key-cipher.js";
import type {
  ChangeLlmConfigurationInput,
  LlmConfigurationSummary,
  ResolvedLlmConfiguration,
  StoredLlmConfiguration,
  TestLlmConfigurationInput,
} from "./llm-configuration.js";
import type { LlmConfigurationRepository } from "./llm-configuration-repository.js";

function toSummary(
  configuration: StoredLlmConfiguration,
): LlmConfigurationSummary {
  return {
    installationId: configuration.installationId,
    provider: configuration.provider,
    model: configuration.model,
    keyLastFour: configuration.keyLastFour,
    baseUrl: configuration.baseUrl,
    updatedByGithubUserId: configuration.updatedByGithubUserId,
    updatedAt: configuration.updatedAt,
  };
}

export class LlmConfigurationService {
  constructor(
    private readonly repository: LlmConfigurationRepository,
    private readonly cipher: ApiKeyCipher,
  ) {}

  async getSummary(
    installationId: number,
  ): Promise<LlmConfigurationSummary | null> {
    const stored = await this.repository.findByInstallationId(installationId);
    return stored ? toSummary(stored) : null;
  }

  async resolve(
    installationId: number,
  ): Promise<ResolvedLlmConfiguration | null> {
    const stored = await this.repository.findByInstallationId(installationId);
    if (!stored) return null;

    return {
      installationId,
      provider: stored.provider,
      model: stored.model,
      apiKey: this.cipher.decrypt(stored.encryptedApiKey),
      baseUrl: stored.baseUrl,
    };
  }

  async test(input: TestLlmConfigurationInput): Promise<void> {
    const existing = await this.repository.findByInstallationId(
      input.installationId,
    );
    const configuration = this.resolveInput(input, existing);
    const provider = createLlmProvider(configuration);

    if (!provider.checkConnection) {
      throw new Error(
        "Ce fournisseur ne permet pas encore de tester la connexion.",
      );
    }
    await provider.checkConnection();
  }

  async save(
    input: ChangeLlmConfigurationInput,
  ): Promise<LlmConfigurationSummary> {
    const existing = await this.repository.findByInstallationId(
      input.installationId,
    );
    const resolved = this.resolveInput(input, existing);

    const provider = createLlmProvider(resolved);
    if (provider.checkConnection) await provider.checkConnection();

    const encryptedApiKey = input.apiKey?.trim()
      ? this.cipher.encrypt(input.apiKey.trim())
      : existing?.encryptedApiKey;
    if (!encryptedApiKey) throw new Error("La clé API est requise.");

    const keyLastFour = input.apiKey?.trim()
      ? getApiKeySuffix(input.apiKey)
      : existing?.keyLastFour;
    if (!keyLastFour) throw new Error("La clé API est requise.");

    const saved = await this.repository.upsert({
      installationId: input.installationId,
      provider: input.provider,
      model: resolved.model,
      encryptedApiKey,
      keyLastFour,
      baseUrl: resolved.baseUrl,
      createdByGithubUserId:
        existing?.createdByGithubUserId ?? input.githubUserId,
      updatedByGithubUserId: input.githubUserId,
    });

    return toSummary(saved);
  }

  async delete(
    installationId: number,
    githubUserId?: number,
  ): Promise<boolean> {
    return this.repository.delete(installationId, githubUserId);
  }

  private resolveInput(
    input: TestLlmConfigurationInput,
    existing: StoredLlmConfiguration | null,
  ): {
    provider: TestLlmConfigurationInput["provider"];
    apiKey: string;
    model: string;
    baseUrl?: string;
  } {
    const newApiKey = input.apiKey?.trim();
    if (!newApiKey && existing && existing.provider !== input.provider) {
      throw new Error(
        "Une nouvelle clé API est requise lors du changement de fournisseur.",
      );
    }

    const apiKey =
      newApiKey ||
      (existing ? this.cipher.decrypt(existing.encryptedApiKey) : "");
    if (!apiKey) throw new Error("La clé API est requise.");

    const definition = getLlmProviderDefinition(input.provider);
    const model = input.model.trim() || definition.defaultModel;
    if (!model) throw new Error("Le modèle LLM est requis.");

    const baseUrl = normalizeProviderBaseUrl(
      input.provider,
      input.provider === "custom" ? input.baseUrl : undefined,
    );

    return {
      provider: input.provider,
      apiKey,
      model,
      baseUrl: input.provider === "custom" ? baseUrl : undefined,
    };
  }
}

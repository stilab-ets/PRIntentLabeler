import type {
  SaveLlmConfiguration,
  StoredLlmConfiguration,
} from "./llm-configuration.js";

export interface LlmConfigurationRepository {
  findByInstallationId(
    installationId: number,
  ): Promise<StoredLlmConfiguration | null>;

  upsert(configuration: SaveLlmConfiguration): Promise<StoredLlmConfiguration>;

  delete(installationId: number, githubUserId?: number): Promise<boolean>;
}

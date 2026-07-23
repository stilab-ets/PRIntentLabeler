import type { EncryptedApiKey } from "../security/api-key-cipher.js";
import type {
  LlmProviderConfiguration,
  LlmProviderName,
} from "../llm/provider-configuration.js";

export type StoredLlmConfiguration = {
  installationId: number;
  provider: LlmProviderName;
  model: string;
  encryptedApiKey: EncryptedApiKey;
  keyLastFour: string;
  baseUrl?: string;
  createdByGithubUserId: number;
  updatedByGithubUserId: number;
  createdAt: Date;
  updatedAt: Date;
};

export type SaveLlmConfiguration = Omit<
  StoredLlmConfiguration,
  "createdAt" | "updatedAt"
>;

export type LlmConfigurationSummary = {
  installationId: number;
  provider: LlmProviderName;
  model: string;
  keyLastFour: string;
  baseUrl?: string;
  updatedByGithubUserId: number;
  updatedAt: Date;
};

export type ChangeLlmConfigurationInput = {
  installationId: number;
  provider: LlmProviderName;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  githubUserId: number;
};

export type TestLlmConfigurationInput = Omit<
  ChangeLlmConfigurationInput,
  "githubUserId"
>;

export type ResolvedLlmConfiguration = LlmProviderConfiguration & {
  installationId: number;
};

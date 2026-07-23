import { getDatabasePool } from "../database/pool.js";
import { ApiKeyCipher } from "../security/api-key-cipher.js";
import { LlmConfigurationService } from "./llm-configuration-service.js";
import { PostgresLlmConfigurationRepository } from "./postgres-llm-configuration-repository.js";

let service: LlmConfigurationService | null | undefined;

export function getLlmConfigurationService(): LlmConfigurationService | null {
  if (service !== undefined) return service;

  const pool = getDatabasePool();
  const encryptionKey = process.env.CONFIG_ENCRYPTION_KEY;
  if (!pool || !encryptionKey) {
    service = null;
    return service;
  }

  service = new LlmConfigurationService(
    new PostgresLlmConfigurationRepository(pool),
    new ApiKeyCipher(encryptionKey),
  );
  return service;
}

export function resetLlmConfigurationServiceForTests(): void {
  service = undefined;
}

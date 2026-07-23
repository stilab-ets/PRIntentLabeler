import type { Pool, PoolClient, QueryResultRow } from "pg";
import { isLlmProviderName } from "../llm/provider-configuration.js";
import type {
  SaveLlmConfiguration,
  StoredLlmConfiguration,
} from "./llm-configuration.js";
import type { LlmConfigurationRepository } from "./llm-configuration-repository.js";

type ConfigurationRow = QueryResultRow & {
  installation_id: string;
  provider: string;
  model: string;
  encrypted_api_key: string;
  encryption_iv: string;
  encryption_auth_tag: string;
  key_last_four: string;
  base_url: string | null;
  created_by_github_user_id: string;
  updated_by_github_user_id: string;
  created_at: Date;
  updated_at: Date;
};

function mapConfigurationRow(row: ConfigurationRow): StoredLlmConfiguration {
  if (!isLlmProviderName(row.provider)) {
    throw new Error(
      `Le fournisseur enregistré « ${row.provider} » n’est pas pris en charge.`,
    );
  }

  return {
    installationId: Number(row.installation_id),
    provider: row.provider,
    model: row.model,
    encryptedApiKey: {
      ciphertext: row.encrypted_api_key,
      iv: row.encryption_iv,
      authTag: row.encryption_auth_tag,
    },
    keyLastFour: row.key_last_four,
    baseUrl: row.base_url ?? undefined,
    createdByGithubUserId: Number(row.created_by_github_user_id),
    updatedByGithubUserId: Number(row.updated_by_github_user_id),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

async function recordAudit(
  client: PoolClient,
  installationId: number,
  action: "created" | "updated" | "deleted",
  githubUserId: number | undefined,
  provider?: string,
  model?: string,
): Promise<void> {
  await client.query(
    `INSERT INTO llm_configuration_audits
      (installation_id, action, provider, model, github_user_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      installationId,
      action,
      provider ?? null,
      model ?? null,
      githubUserId ?? null,
    ],
  );
}

export class PostgresLlmConfigurationRepository implements LlmConfigurationRepository {
  constructor(private readonly pool: Pool) {}

  async findByInstallationId(
    installationId: number,
  ): Promise<StoredLlmConfiguration | null> {
    const result = await this.pool.query<ConfigurationRow>(
      `SELECT installation_id, provider, model, encrypted_api_key,
              encryption_iv, encryption_auth_tag, key_last_four, base_url,
              created_by_github_user_id, updated_by_github_user_id,
              created_at, updated_at
       FROM llm_configurations
       WHERE installation_id = $1`,
      [installationId],
    );

    return result.rows[0] ? mapConfigurationRow(result.rows[0]) : null;
  }

  async upsert(
    configuration: SaveLlmConfiguration,
  ): Promise<StoredLlmConfiguration> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const existing = await client.query(
        "SELECT 1 FROM llm_configurations WHERE installation_id = $1",
        [configuration.installationId],
      );

      const result = await client.query<ConfigurationRow>(
        `INSERT INTO llm_configurations
          (installation_id, provider, model, encrypted_api_key,
           encryption_iv, encryption_auth_tag, key_last_four, base_url,
           created_by_github_user_id, updated_by_github_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (installation_id) DO UPDATE SET
           provider = EXCLUDED.provider,
           model = EXCLUDED.model,
           encrypted_api_key = EXCLUDED.encrypted_api_key,
           encryption_iv = EXCLUDED.encryption_iv,
           encryption_auth_tag = EXCLUDED.encryption_auth_tag,
           key_last_four = EXCLUDED.key_last_four,
           base_url = EXCLUDED.base_url,
           updated_by_github_user_id = EXCLUDED.updated_by_github_user_id,
           updated_at = NOW()
         RETURNING installation_id, provider, model, encrypted_api_key,
                   encryption_iv, encryption_auth_tag, key_last_four, base_url,
                   created_by_github_user_id, updated_by_github_user_id,
                   created_at, updated_at`,
        [
          configuration.installationId,
          configuration.provider,
          configuration.model,
          configuration.encryptedApiKey.ciphertext,
          configuration.encryptedApiKey.iv,
          configuration.encryptedApiKey.authTag,
          configuration.keyLastFour,
          configuration.baseUrl ?? null,
          configuration.createdByGithubUserId,
          configuration.updatedByGithubUserId,
        ],
      );

      await recordAudit(
        client,
        configuration.installationId,
        existing.rowCount ? "updated" : "created",
        configuration.updatedByGithubUserId,
        configuration.provider,
        configuration.model,
      );
      await client.query("COMMIT");
      return mapConfigurationRow(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async delete(
    installationId: number,
    githubUserId?: number,
  ): Promise<boolean> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const existing = await client.query<{
        provider: string;
        model: string;
      }>(
        `DELETE FROM llm_configurations
         WHERE installation_id = $1
         RETURNING provider, model`,
        [installationId],
      );

      if (existing.rows[0]) {
        await recordAudit(
          client,
          installationId,
          "deleted",
          githubUserId,
          existing.rows[0].provider,
          existing.rows[0].model,
        );
      }

      await client.query("COMMIT");
      return Boolean(existing.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

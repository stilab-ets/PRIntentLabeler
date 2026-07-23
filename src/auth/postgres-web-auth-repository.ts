import type { Pool } from "pg";
import type { OAuthState, WebAuthRepository, WebSession } from "./web-auth.js";

export class PostgresWebAuthRepository implements WebAuthRepository {
  constructor(private readonly pool: Pool) {}

  async createOAuthState(
    stateHash: string,
    installationId: number | undefined,
    expiresAt: Date,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO oauth_states (state_hash, installation_id, expires_at)
       VALUES ($1, $2, $3)`,
      [stateHash, installationId ?? null, expiresAt],
    );
  }

  async consumeOAuthState(stateHash: string): Promise<OAuthState | null> {
    const result = await this.pool.query<{
      installation_id: string | null;
    }>(
      `DELETE FROM oauth_states
       WHERE state_hash = $1 AND expires_at > NOW()
       RETURNING installation_id`,
      [stateHash],
    );

    const row = result.rows[0];
    if (!row) return null;
    return {
      installationId:
        row.installation_id === null ? undefined : Number(row.installation_id),
    };
  }

  async createSession(sessionHash: string, session: WebSession): Promise<void> {
    await this.pool.query(
      `INSERT INTO web_sessions
        (session_hash, github_user_id, github_login, installation_ids,
         csrf_token, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (session_hash) DO UPDATE SET
         github_user_id = EXCLUDED.github_user_id,
         github_login = EXCLUDED.github_login,
         installation_ids = EXCLUDED.installation_ids,
         csrf_token = EXCLUDED.csrf_token,
         expires_at = EXCLUDED.expires_at`,
      [
        sessionHash,
        session.githubUserId,
        session.githubLogin,
        session.installationIds,
        session.csrfToken,
        session.expiresAt,
      ],
    );
  }

  async findSession(sessionHash: string): Promise<WebSession | null> {
    const result = await this.pool.query<{
      github_user_id: string;
      github_login: string;
      installation_ids: string[];
      csrf_token: string;
      expires_at: Date;
    }>(
      `SELECT github_user_id, github_login, installation_ids,
              csrf_token, expires_at
       FROM web_sessions
       WHERE session_hash = $1 AND expires_at > NOW()`,
      [sessionHash],
    );

    const row = result.rows[0];
    if (!row) return null;
    return {
      githubUserId: Number(row.github_user_id),
      githubLogin: row.github_login,
      installationIds: row.installation_ids.map(Number),
      csrfToken: row.csrf_token,
      expiresAt: new Date(row.expires_at),
    };
  }

  async deleteSession(sessionHash: string): Promise<void> {
    await this.pool.query("DELETE FROM web_sessions WHERE session_hash = $1", [
      sessionHash,
    ]);
  }
}

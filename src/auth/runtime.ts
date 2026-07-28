import { getDatabasePool } from "../database/pool.js";
import { GitHubOAuthService } from "./github-oauth-service.js";
import { PostgresWebAuthRepository } from "./postgres-web-auth-repository.js";

let service: GitHubOAuthService | null | undefined;

export function getGitHubOAuthService(): GitHubOAuthService | null {
  if (service !== undefined) return service;

  const pool = getDatabasePool();
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const publicBaseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "");

  if (!pool || !clientId || !clientSecret || !publicBaseUrl) {
    service = null;
    return service;
  }

  service = new GitHubOAuthService(new PostgresWebAuthRepository(pool), {
    clientId,
    clientSecret,
    callbackUrl: `${publicBaseUrl}/auth/github/callback`,
  });
  return service;
}

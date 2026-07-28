import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubOAuthService } from "../src/auth/github-oauth-service.js";
import type {
  OAuthState,
  WebAuthRepository,
  WebSession,
} from "../src/auth/web-auth.js";

class InMemoryWebAuthRepository implements WebAuthRepository {
  states = new Map<string, OAuthState>();
  sessions = new Map<string, WebSession>();

  async createOAuthState(
    stateHash: string,
    installationId: number | undefined,
  ): Promise<void> {
    this.states.set(stateHash, { installationId });
  }

  async consumeOAuthState(stateHash: string): Promise<OAuthState | null> {
    const state = this.states.get(stateHash) ?? null;
    this.states.delete(stateHash);
    return state;
  }

  async createSession(sessionHash: string, session: WebSession): Promise<void> {
    this.sessions.set(sessionHash, session);
  }

  async findSession(sessionHash: string): Promise<WebSession | null> {
    return this.sessions.get(sessionHash) ?? null;
  }

  async deleteSession(sessionHash: string): Promise<void> {
    this.sessions.delete(sessionHash);
  }
}

function createService(repository: InMemoryWebAuthRepository) {
  return new GitHubOAuthService(repository, {
    clientId: "client-id",
    clientSecret: "client-secret",
    callbackUrl: "https://app.example.com/auth/github/callback",
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHubOAuthService", () => {
  it("valide l’installation avant de créer une session", async () => {
    const repository = new InMemoryWebAuthRepository();
    const service = createService(repository);
    const authorizationUrl = new URL(await service.createAuthorizationUrl(123));
    const state = authorizationUrl.searchParams.get("state")!;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const value = url.toString();
        if (value.includes("login/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "github-token" }));
        }
        if (value.endsWith("/user")) {
          return new Response(JSON.stringify({ id: 7, login: "talip" }));
        }
        return new Response(
          JSON.stringify({
            installations: [
              {
                id: 123,
                account: { login: "stilab-ets", type: "Organization" },
              },
            ],
          }),
        );
      }),
    );

    const result = await service.completeAuthorization("code", state);

    expect(result.requestedInstallationId).toBe(123);
    expect(result.session.githubLogin).toBe("talip");
    expect(result.session.installationIds).toEqual([123]);
    expect(repository.sessions.size).toBe(1);
    expect([...repository.sessions.keys()][0]).not.toBe(result.sessionToken);
  });

  it("refuse un installation_id qui n’appartient pas au compte", async () => {
    const repository = new InMemoryWebAuthRepository();
    const service = createService(repository);
    const authorizationUrl = new URL(await service.createAuthorizationUrl(999));
    const state = authorizationUrl.searchParams.get("state")!;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const value = url.toString();
        if (value.includes("login/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "github-token" }));
        }
        if (value.endsWith("/user")) {
          return new Response(JSON.stringify({ id: 7, login: "talip" }));
        }
        return new Response(JSON.stringify({ installations: [] }));
      }),
    );

    await expect(service.completeAuthorization("code", state)).rejects.toThrow(
      "n’est pas accessible",
    );
    expect(repository.sessions.size).toBe(0);
  });

  it("empêche la réutilisation d’un paramètre state", async () => {
    const repository = new InMemoryWebAuthRepository();
    const service = createService(repository);
    const authorizationUrl = new URL(await service.createAuthorizationUrl());
    const state = authorizationUrl.searchParams.get("state")!;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (url.toString().includes("login/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "github-token" }));
        }
        if (url.toString().endsWith("/user")) {
          return new Response(JSON.stringify({ id: 7, login: "talip" }));
        }
        return new Response(JSON.stringify({ installations: [] }));
      }),
    );

    await service.completeAuthorization("code", state);
    await expect(service.completeAuthorization("code", state)).rejects.toThrow(
      "expirée ou a déjà été utilisée",
    );
  });
});

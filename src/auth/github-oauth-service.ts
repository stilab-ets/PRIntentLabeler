import { createHash, randomBytes } from "node:crypto";
import type {
  GitHubInstallation,
  GitHubUser,
  OAuthState,
  WebAuthRepository,
  WebSession,
} from "./web-auth.js";

type GitHubOAuthOptions = {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
};

type TokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type GitHubUserResponse = {
  id?: number;
  login?: string;
};

type GitHubInstallationsResponse = {
  installations?: Array<{
    id?: number;
    account?: {
      login?: string;
      type?: string;
      avatar_url?: string;
    } | null;
  }>;
};

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function githubRequest<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "PRIntentLabeler",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`GitHub a rejeté la requête OAuth (${response.status}).`);
  }

  return (await response.json()) as T;
}

export class GitHubOAuthService {
  constructor(
    private readonly repository: WebAuthRepository,
    private readonly options: GitHubOAuthOptions,
  ) {}

  async createAuthorizationUrl(installationId?: number): Promise<string> {
    const state = randomBytes(32).toString("hex");
    await this.repository.createOAuthState(
      hashToken(state),
      installationId,
      new Date(Date.now() + 10 * 60 * 1000),
    );

    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", this.options.clientId);
    url.searchParams.set("redirect_uri", this.options.callbackUrl);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async completeAuthorization(
    code: string,
    state: string,
  ): Promise<{
    sessionToken: string;
    session: WebSession;
    requestedInstallationId?: number;
    installations: GitHubInstallation[];
  }> {
    const oauthState = await this.consumeState(state);
    const accessToken = await this.exchangeCode(code);
    const [user, installations] = await Promise.all([
      this.fetchUser(accessToken),
      this.fetchInstallations(accessToken),
    ]);

    if (
      oauthState.installationId &&
      !installations.some(
        (installation) => installation.id === oauthState.installationId,
      )
    ) {
      throw new Error(
        "Cette installation GitHub n’est pas accessible à l’utilisateur connecté.",
      );
    }

    const sessionToken = randomBytes(32).toString("hex");
    const session: WebSession = {
      githubUserId: user.id,
      githubLogin: user.login,
      installationIds: installations.map((installation) => installation.id),
      csrfToken: randomBytes(32).toString("hex"),
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
    };

    await this.repository.createSession(hashToken(sessionToken), session);
    return {
      sessionToken,
      session,
      requestedInstallationId: oauthState.installationId,
      installations,
    };
  }

  async getSession(sessionToken: string): Promise<WebSession | null> {
    if (!/^[a-f0-9]{64}$/.test(sessionToken)) return null;
    return this.repository.findSession(hashToken(sessionToken));
  }

  async deleteSession(sessionToken: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(sessionToken)) return;
    await this.repository.deleteSession(hashToken(sessionToken));
  }

  private async consumeState(state: string): Promise<OAuthState> {
    if (!/^[a-f0-9]{64}$/.test(state)) {
      throw new Error("Le paramètre OAuth state est invalide.");
    }

    const stored = await this.repository.consumeOAuthState(hashToken(state));
    if (!stored) {
      throw new Error("La demande OAuth est expirée ou a déjà été utilisée.");
    }
    return stored;
  }

  private async exchangeCode(code: string): Promise<string> {
    const response = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "PRIntentLabeler",
        },
        body: new URLSearchParams({
          client_id: this.options.clientId,
          client_secret: this.options.clientSecret,
          code,
          redirect_uri: this.options.callbackUrl,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    const payload = (await response.json()) as TokenResponse;
    if (!response.ok || !payload.access_token) {
      throw new Error(
        payload.error_description ||
          payload.error ||
          "GitHub n’a pas retourné de jeton utilisateur.",
      );
    }
    return payload.access_token;
  }

  private async fetchUser(accessToken: string): Promise<GitHubUser> {
    const payload = await githubRequest<GitHubUserResponse>(
      "https://api.github.com/user",
      accessToken,
    );
    if (!payload.id || !payload.login) {
      throw new Error("Le compte GitHub connecté est invalide.");
    }
    return { id: payload.id, login: payload.login };
  }

  private async fetchInstallations(
    accessToken: string,
  ): Promise<GitHubInstallation[]> {
    const installations: GitHubInstallation[] = [];

    for (let page = 1; page <= 10; page += 1) {
      const payload = await githubRequest<GitHubInstallationsResponse>(
        `https://api.github.com/user/installations?per_page=100&page=${page}`,
        accessToken,
      );
      const current = payload.installations ?? [];

      for (const installation of current) {
        if (!installation.id || !installation.account?.login) continue;
        installations.push({
          id: installation.id,
          account: {
            login: installation.account.login,
            type: installation.account.type ?? "Unknown",
            avatarUrl: installation.account.avatar_url,
          },
        });
      }

      if (current.length < 100) break;
    }

    return installations;
  }
}

export type OAuthState = {
  installationId?: number;
};

export type WebSession = {
  githubUserId: number;
  githubLogin: string;
  installationIds: number[];
  csrfToken: string;
  expiresAt: Date;
};

export type GitHubInstallation = {
  id: number;
  account: {
    login: string;
    type: string;
    avatarUrl?: string;
  };
};

export type GitHubUser = {
  id: number;
  login: string;
};

export interface WebAuthRepository {
  createOAuthState(
    stateHash: string,
    installationId: number | undefined,
    expiresAt: Date,
  ): Promise<void>;

  consumeOAuthState(stateHash: string): Promise<OAuthState | null>;

  createSession(sessionHash: string, session: WebSession): Promise<void>;

  findSession(sessionHash: string): Promise<WebSession | null>;

  deleteSession(sessionHash: string): Promise<void>;
}

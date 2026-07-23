CREATE TABLE IF NOT EXISTS llm_configurations (
  installation_id BIGINT PRIMARY KEY,
  provider VARCHAR(32) NOT NULL CHECK (
    provider IN (
      'groq',
      'openai',
      'anthropic',
      'gemini',
      'xai',
      'perplexity',
      'custom'
    )
  ),
  model TEXT NOT NULL,
  encrypted_api_key TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  encryption_auth_tag TEXT NOT NULL,
  key_last_four VARCHAR(4) NOT NULL,
  base_url TEXT,
  created_by_github_user_id BIGINT NOT NULL,
  updated_by_github_user_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS llm_configuration_audits (
  id BIGSERIAL PRIMARY KEY,
  installation_id BIGINT NOT NULL,
  action VARCHAR(16) NOT NULL CHECK (
    action IN ('created', 'updated', 'deleted')
  ),
  provider VARCHAR(32),
  model TEXT,
  github_user_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS llm_configuration_audits_installation_idx
  ON llm_configuration_audits (installation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash VARCHAR(64) PRIMARY KEY,
  installation_id BIGINT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS web_sessions (
  session_hash VARCHAR(64) PRIMARY KEY,
  github_user_id BIGINT NOT NULL,
  github_login TEXT NOT NULL,
  installation_ids BIGINT[] NOT NULL,
  csrf_token VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS web_sessions_expires_at_idx
  ON web_sessions (expires_at);

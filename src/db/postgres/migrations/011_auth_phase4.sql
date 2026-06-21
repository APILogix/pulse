-- Phase 4 auth: OIDC SSO columns, trusted devices, email outbox.

BEGIN;

-- OIDC configuration on org SSO providers (SAML continues using existing columns).
ALTER TABLE organization_sso_providers
  ADD COLUMN IF NOT EXISTS oidc_issuer TEXT,
  ADD COLUMN IF NOT EXISTS oidc_client_id TEXT,
  ADD COLUMN IF NOT EXISTS oidc_client_secret_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS oidc_scopes TEXT DEFAULT 'openid email profile';

COMMENT ON COLUMN organization_sso_providers.oidc_client_secret_encrypted IS
  'AES-256-GCM encrypted client secret; plaintext never stored.';

-- Trusted devices: reduce MFA friction on known fingerprints (LRU + DB).
CREATE TABLE IF NOT EXISTS user_trusted_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_fingerprint VARCHAR(64) NOT NULL,
    device_name VARCHAR(255),
    ip_address INET,
    user_agent TEXT,
    trusted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    UNIQUE (user_id, device_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_user_active
  ON user_trusted_devices(user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

-- Durable email outbox (processed by auth cleanup worker; no Redis).
CREATE TABLE IF NOT EXISTS auth_email_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    to_email VARCHAR(255) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    html TEXT NOT NULL,
    text TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_email_outbox_pending
  ON auth_email_outbox(created_at)
  WHERE status = 'pending';

COMMIT;

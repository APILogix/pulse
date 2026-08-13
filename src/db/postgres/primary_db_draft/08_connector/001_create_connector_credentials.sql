-- Normalized final definition for connector_credentials.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/06_connectors/002_create_connector_credentials.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS connector_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,
  credential_type VARCHAR(50) NOT NULL,
  key_name VARCHAR(100) NOT NULL,
  encrypted_value BYTEA NOT NULL,
  algorithm VARCHAR(50),
  version INTEGER NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ,
  rotated_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(connector_id,key_name)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_credential_key
ON connector_credentials (connector_id, key_name);

CREATE INDEX IF NOT EXISTS idx_credentials_connector
ON connector_credentials (connector_id);

CREATE INDEX IF NOT EXISTS idx_credentials_type
ON connector_credentials (credential_type);

CREATE INDEX IF NOT EXISTS idx_credentials_expiry
ON connector_credentials (expires_at)
WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credentials_last_used
ON connector_credentials (last_used_at DESC);

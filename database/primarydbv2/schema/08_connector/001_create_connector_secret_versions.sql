-- Normalized final definition for connector_secret_versions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/06_connectors/003_create_connector_secret_versions.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS connector_secret_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id UUID NOT NULL REFERENCES connector_credentials(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  encrypted_value BYTEA NOT NULL,
  rotated_by UUID REFERENCES users(id),
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_secret_versions_lookup
ON connector_secret_versions (credential_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_secret_rotated_at
ON connector_secret_versions (rotated_at DESC);

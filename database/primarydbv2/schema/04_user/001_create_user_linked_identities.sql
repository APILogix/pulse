-- Normalized final definition for user_linked_identities.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/01_auth/008_create_user_linked_identities.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS user_linked_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL,
  provider_subject VARCHAR(255) NOT NULL,
  provider_email VARCHAR(255),
  profile_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT user_linked_identities_provider_subject_unique
  UNIQUE (provider, provider_subject),
  CONSTRAINT user_linked_identities_user_provider_unique
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_linked_identities_user_active
  ON user_linked_identities(user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_linked_identities_user_all
  ON user_linked_identities (user_id, linked_at DESC);

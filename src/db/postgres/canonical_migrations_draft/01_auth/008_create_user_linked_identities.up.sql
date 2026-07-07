BEGIN;

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

COMMIT;

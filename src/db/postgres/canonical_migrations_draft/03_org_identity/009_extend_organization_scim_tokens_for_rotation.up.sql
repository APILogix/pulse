BEGIN;

ALTER TABLE organization_scim_tokens
  ADD COLUMN IF NOT EXISTS rotated_from UUID REFERENCES organization_scim_tokens(id),
  ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_scim_tokens_rotated_from
  ON organization_scim_tokens(rotated_from)
  WHERE rotated_from IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scim_tokens_grace_window
  ON organization_scim_tokens(grace_period_ends_at)
  WHERE grace_period_ends_at IS NOT NULL;

COMMIT;

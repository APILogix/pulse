-- Normalized final definition for alert_rule_revisions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/08_alerting/021_create_alert_rule_revisions.up.sql

CREATE TABLE IF NOT EXISTS alert_rule_revisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id         UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  revision        INTEGER NOT NULL CHECK (revision >= 1),
  change_kind     VARCHAR(40) NOT NULL,
  snapshot        JSONB NOT NULL,
  actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alert_rule_revision UNIQUE (rule_id, revision),
  CONSTRAINT ck_alert_rule_revision_change_kind CHECK (
  change_kind IN ('rule','condition','action','binding')
  ),
  CONSTRAINT ck_alert_rule_revision_snapshot CHECK (
  jsonb_typeof(snapshot) = 'object'
  )
);

CREATE INDEX IF NOT EXISTS idx_alert_rule_revisions_rule
  ON alert_rule_revisions (rule_id, revision DESC);

CREATE INDEX IF NOT EXISTS idx_alert_rule_revisions_org
  ON alert_rule_revisions (organization_id, created_at DESC);

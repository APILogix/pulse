BEGIN;

CREATE TABLE IF NOT EXISTS alert_usage_facts (
  id               UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL,
  project_id       UUID,
  usage_kind       alert_usage_kind NOT NULL,
  idempotency_key  VARCHAR(255) NOT NULL,
  quantity         INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_usage_facts_default
  PARTITION OF alert_usage_facts DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_usage_facts_idem
  ON alert_usage_facts (organization_id, idempotency_key, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_usage_facts_org_kind
  ON alert_usage_facts (organization_id, usage_kind, created_at DESC);

COMMIT;

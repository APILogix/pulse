-- Canonical append-only alert lifecycle transitions (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS alert_events_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  project_id            UUID,
  environment           TEXT,
  rule_id               UUID NOT NULL,
  binding_id            UUID,
  fingerprint           VARCHAR(255) NOT NULL,
  alert_key             VARCHAR(512) NOT NULL,
  kind                  alert_event_kind NOT NULL,
  severity              logdb_severity NOT NULL,
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_event_ids      TEXT[] NOT NULL DEFAULT '{}'::text[],
  occurred_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key       VARCHAR(255) NOT NULL,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_events_v2_default PARTITION OF alert_events_v2 DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_events_v2_idem
  ON alert_events_v2 (organization_id, idempotency_key, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_events_v2_fingerprint
  ON alert_events_v2 (organization_id, fingerprint, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_v2_scope
  ON alert_events_v2 (organization_id, project_id, environment, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_v2_rule
  ON alert_events_v2 (organization_id, rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_v2_kind
  ON alert_events_v2 (organization_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_v2_occurred_brin
  ON alert_events_v2 USING BRIN (occurred_at);

BEGIN;

CREATE TABLE IF NOT EXISTS telemetry_outbox (
  id               BIGSERIAL,
  organization_id  UUID NOT NULL,
  project_id       UUID,
  environment      VARCHAR(64),
  signal_kind      VARCHAR(32) NOT NULL,
  event_id         TEXT NOT NULL,
  severity         logdb_severity,
  fast_path        BOOLEAN NOT NULL DEFAULT FALSE,
  attributes       JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at      TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at       TIMESTAMPTZ,
  claimed_by       VARCHAR(128),
  published_at     TIMESTAMPTZ,
  attempts         SMALLINT NOT NULL DEFAULT 0,
  last_error       TEXT,
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_telemetry_outbox_signal_kind CHECK (
    signal_kind IN ('error','cron_checkin','log','request','metric','message','span','trace','profile','replay')
  )
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS telemetry_outbox_default
  PARTITION OF telemetry_outbox DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_telemetry_outbox_idem
  ON telemetry_outbox (organization_id, signal_kind, event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_telemetry_outbox_unpublished
  ON telemetry_outbox (fast_path DESC, created_at)
  WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_telemetry_outbox_claimed
  ON telemetry_outbox (claimed_at)
  WHERE published_at IS NULL AND claimed_at IS NOT NULL;

COMMENT ON TABLE telemetry_outbox IS
  'Transactional alerting outbox for telemetry persisted into events_*. Fast-path rows drive alert.evaluate.fast; aggregate rows act as hints for window tiers.';

COMMIT;

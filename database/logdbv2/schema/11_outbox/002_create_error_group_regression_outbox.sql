-- Dead-letter and regression notification outbox for reopened error groups (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS error_group_regression_outbox (
  id                  BIGSERIAL,
  organization_id     UUID NOT NULL,
  project_id          UUID NOT NULL,
  environment         TEXT NOT NULL,
  error_group_id      UUID NOT NULL,
  fingerprint         TEXT NOT NULL,
  resolved_in_release TEXT,
  reopened_in_release TEXT,
  triggering_event_id TEXT NOT NULL,
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  published_at        TIMESTAMPTZ,
  claimed_at          TIMESTAMPTZ,
  claim_owner         TEXT,
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  last_error          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT eg_regr_outbox_env_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS error_group_regression_outbox_default PARTITION OF error_group_regression_outbox DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_error_group_regression_outbox_idem
  ON error_group_regression_outbox (organization_id, error_group_id, triggering_event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_error_group_regression_outbox_unpublished
  ON error_group_regression_outbox (created_at)
  WHERE published_at IS NULL;

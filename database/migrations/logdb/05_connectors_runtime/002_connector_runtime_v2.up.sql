-- =============================================================================
-- Log DB : L6 — Typed connector runtime (v2)
-- Architecture : docs/alerting-redesign/02-data-model.md §10
--                docs/alerting-redesign/adr/0006-database-ownership.md
--                docs/alerting-redesign/adr/0008-connector-isolation.md
-- Increment    : 1 (schema ownership stabilization)
--
-- Additive only. The generic 5-table loop in 001_connector_runtime.up.sql is left
-- untouched so old code keeps running during rolling deployment.
--
-- Fixes audit findings A4, A5, A6, C1, C2, C3, C6.
--   A4 : connector_deliveries_v2 carries the rich shape the code already expects
--        and ONE status vocabulary (no delivered/sent split)
--   A5 : connector_delivery_attempts_v2 regains (delivery_id, delivery_created_at)
--   A6 : health checks / test runs / audit logs become purpose-built tables
--   C6 : connector_dead_letters is a real, queryable, replayable table instead of
--        an audit-log row with action='delivery.dead_lettered'
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'connector_delivery_status_v2') THEN
    CREATE TYPE connector_delivery_status_v2 AS ENUM (
      'pending','queued','sent','retrying','failed','suppressed','cancelled'
    );
  END IF;
END $$;

-- ── 1. connector_deliveries_v2 ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS connector_deliveries_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  project_id            UUID,
  connector_id          UUID NOT NULL,
  route_id              UUID,
  notification_job_id   UUID,
  alert_event_id        UUID,
  channel_kind          notification_channel_kind,
  notification_type     VARCHAR(100) NOT NULL DEFAULT 'alert',
  severity              logdb_severity NOT NULL DEFAULT 'info',

  status                connector_delivery_status_v2 NOT NULL DEFAULT 'pending',
  correlation_id        UUID NOT NULL,
  idempotency_key       VARCHAR(255),

  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_size_bytes    INTEGER,
  response_status_code  INTEGER,
  response_body         TEXT,
  external_message_id   VARCHAR(255),
  error_category        VARCHAR(64),
  error_message         TEXT,
  error_details         JSONB,

  attempts              INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts          INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  retry_count           INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  next_retry_at         TIMESTAMPTZ,
  latency_ms            INTEGER,

  sent_at               TIMESTAMPTZ,
  failed_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS connector_deliveries_v2_default
  PARTITION OF connector_deliveries_v2 DEFAULT;

-- Idempotent dispatch (02-data-model.md §10). No WHERE clause is needed: NULLs are
-- distinct in a unique index by default, so backfilled rows without an idempotency
-- key never collide with each other. This also avoids a partial UNIQUE index on a
-- partitioned table.
CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_deliveries_v2_idem
  ON connector_deliveries_v2 (connector_id, idempotency_key, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_deliveries_v2_correlation
  ON connector_deliveries_v2 (connector_id, correlation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_v2_retry
  ON connector_deliveries_v2 (status, next_retry_at)
  WHERE status IN ('pending','retrying');
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_v2_org
  ON connector_deliveries_v2 (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_v2_connector
  ON connector_deliveries_v2 (connector_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_v2_job
  ON connector_deliveries_v2 (notification_job_id, created_at DESC)
  WHERE notification_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_connector_deliveries_v2_brin
  ON connector_deliveries_v2 USING BRIN (created_at);

COMMENT ON COLUMN connector_deliveries_v2.notification_job_id IS
  'Joins transport truth back to the alert (fixes the queued-forever gap where alert '
  'delivery attempts and connector deliveries had no join key).';

-- ── 2. connector_delivery_attempts_v2 (fixes A5: missing delivery_id) ─────────
CREATE TABLE IF NOT EXISTS connector_delivery_attempts_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  connector_id          UUID NOT NULL,
  delivery_id           UUID NOT NULL,
  delivery_created_at   TIMESTAMPTZ NOT NULL,
  attempt_number        INTEGER NOT NULL CHECK (attempt_number >= 1),
  status                connector_delivery_status_v2 NOT NULL,
  response_status_code  INTEGER,
  error_category        VARCHAR(64),
  error_message         TEXT,
  response              JSONB,
  duration_ms           INTEGER,
  attempted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, attempted_at)
) PARTITION BY RANGE (attempted_at);

CREATE TABLE IF NOT EXISTS connector_delivery_attempts_v2_default
  PARTITION OF connector_delivery_attempts_v2 DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_delivery_attempts_v2_idem
  ON connector_delivery_attempts_v2 (delivery_id, attempt_number, attempted_at);
CREATE INDEX IF NOT EXISTS idx_connector_delivery_attempts_v2_delivery
  ON connector_delivery_attempts_v2 (delivery_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_delivery_attempts_v2_connector
  ON connector_delivery_attempts_v2 (connector_id, status, attempted_at DESC);

-- ── 3. connector_health_checks_v2 (purpose-built, fixes A6) ───────────────────
CREATE TABLE IF NOT EXISTS connector_health_checks_v2 (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL,
  connector_id      UUID NOT NULL,
  health_state      VARCHAR(24) NOT NULL,
  response_time_ms  INTEGER,
  error_message     TEXT,
  details           JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, checked_at),
  CONSTRAINT ck_connector_health_checks_v2_state CHECK (
    health_state IN ('healthy','degraded','unhealthy','unknown')
  )
) PARTITION BY RANGE (checked_at);

CREATE TABLE IF NOT EXISTS connector_health_checks_v2_default
  PARTITION OF connector_health_checks_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_connector_health_checks_v2_connector
  ON connector_health_checks_v2 (connector_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_health_checks_v2_unhealthy
  ON connector_health_checks_v2 (organization_id, checked_at DESC)
  WHERE health_state <> 'healthy';

-- ── 4. connector_test_runs_v2 (purpose-built, fixes A6) ──────────────────────
CREATE TABLE IF NOT EXISTS connector_test_runs_v2 (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL,
  connector_id      UUID NOT NULL,
  triggered_by      UUID,
  status            VARCHAR(24) NOT NULL,
  response          JSONB,
  error_message     TEXT,
  duration_ms       INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_connector_test_runs_v2_status CHECK (
    status IN ('success','failure','error','skipped')
  )
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS connector_test_runs_v2_default
  PARTITION OF connector_test_runs_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_connector_test_runs_v2_connector
  ON connector_test_runs_v2 (connector_id, created_at DESC);

-- ── 5. connector_audit_logs_v2 (purpose-built, fixes A6) ─────────────────────
CREATE TABLE IF NOT EXISTS connector_audit_logs_v2 (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL,
  connector_id      UUID,
  action            VARCHAR(64) NOT NULL,
  actor_type        VARCHAR(24) NOT NULL DEFAULT 'system',
  actor_user_id     UUID,
  previous_state    JSONB,
  new_state         JSONB,
  changes_summary   JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address        INET,
  user_agent        TEXT,
  request_id        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_connector_audit_logs_v2_actor CHECK (
    actor_type IN ('user','system','worker','api')
  )
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS connector_audit_logs_v2_default
  PARTITION OF connector_audit_logs_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_connector_audit_logs_v2_connector
  ON connector_audit_logs_v2 (connector_id, created_at DESC)
  WHERE connector_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_connector_audit_logs_v2_org
  ON connector_audit_logs_v2 (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_audit_logs_v2_action
  ON connector_audit_logs_v2 (action, created_at DESC);

-- ── 6. connector_dead_letters (fixes C6: real DLQ with replay) ───────────────
CREATE TABLE IF NOT EXISTS connector_dead_letters (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  connector_id          UUID,
  delivery_id           UUID,
  notification_job_id   UUID,
  channel_kind          notification_channel_kind,
  failure_category      VARCHAR(64) NOT NULL,
  failure_reason        TEXT NOT NULL,
  error_stack           TEXT,
  attempts              INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  status                VARCHAR(24) NOT NULL DEFAULT 'pending_retry',
  replayed_at           TIMESTAMPTZ,
  replayed_by           UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_connector_dead_letters_status CHECK (
    status IN ('pending_retry','replayed','exhausted','discarded')
  )
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS connector_dead_letters_default
  PARTITION OF connector_dead_letters DEFAULT;

CREATE INDEX IF NOT EXISTS idx_connector_dead_letters_status
  ON connector_dead_letters (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_dead_letters_org
  ON connector_dead_letters (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_dead_letters_delivery
  ON connector_dead_letters (delivery_id, created_at DESC)
  WHERE delivery_id IS NOT NULL;

COMMENT ON TABLE connector_dead_letters IS
  'Queryable, replayable connector dead-letter store. Replaces the previous practice '
  'of recording dead letters as connector_audit_logs rows with '
  'action=delivery.dead_lettered, which had no replay path.';

COMMIT;

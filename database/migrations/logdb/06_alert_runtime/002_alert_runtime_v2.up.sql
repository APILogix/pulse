-- =============================================================================
-- Log DB : L3 — Typed, append-oriented alert runtime (v2)
-- Architecture : docs/alerting-redesign/02-data-model.md §3
--                docs/alerting-redesign/07-migration-plan.md §2 (_v2 + view swap)
--                docs/alerting-redesign/adr/0006-database-ownership.md
-- Increment    : 1 (schema ownership stabilization)
--
-- Replaces the generic 9-table loop in 001_alert_runtime.up.sql. That table set is
-- NOT touched here: this migration is purely additive so old and new code can run
-- side by side during rolling deployment. The rename/view swap is L9 (release N+2)
-- and the legacy drop is L10 (release N+3).
--
-- Fixes audit findings A1, A2, A3, C1, C2, C3.
--   A1/A2 : typed alert_events_v2 / alert_delivery_attempts_v2 replace the generic set
--   A3    : alert_throttle_windows is REPLACED by append-only alert_notification_ledger
--   C1    : append-only tables carry no updated_at; the one mutable projection
--           (alert_event_state) gets the logdb_set_updated_at trigger
--   C2    : every partitioned table gets a DEFAULT partition now; time-bounded
--           partitions are created by the partition manager (L7)
--   C3    : every table carries an explicit idempotency unique index
-- =============================================================================

BEGIN;

-- ── 1. alert_events_v2 — append-only alert fact ──────────────────────────────
CREATE TABLE IF NOT EXISTS alert_events_v2 (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL,
  project_id        UUID,
  environment       VARCHAR(64),
  service           VARCHAR(255),
  endpoint          VARCHAR(500),
  rule_id           UUID,
  binding_id        UUID,
  rule_revision     INTEGER,
  kind              alert_event_kind NOT NULL,
  severity          logdb_severity NOT NULL,
  priority          SMALLINT NOT NULL DEFAULT 0,
  fingerprint       VARCHAR(255) NOT NULL,
  dedup_key         VARCHAR(255) NOT NULL,
  correlation_key   VARCHAR(255),
  group_key         VARCHAR(255),
  source            VARCHAR(100) NOT NULL,
  engine            VARCHAR(16) NOT NULL,
  idempotency_key   VARCHAR(255) NOT NULL,
  observed_value    NUMERIC(20,6),
  threshold_value   NUMERIC(20,6),
  evidence          JSONB NOT NULL DEFAULT '{}'::jsonb,
  policy_snapshot   JSONB NOT NULL DEFAULT '{}'::jsonb,
  labels            JSONB NOT NULL DEFAULT '{}'::jsonb,
  annotations       JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at       TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_alert_events_v2_environment CHECK (
    environment IS NULL OR (
      char_length(environment) BETWEEN 1 AND 64
      AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    )
  ),
  CONSTRAINT ck_alert_events_v2_engine CHECK (
    engine IN ('fast','window','reconcile','api','legacy')
  )
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

COMMENT ON TABLE alert_events_v2 IS
  'Append-only alert fact. rule_id/binding_id are identifiers only, never foreign keys '
  '(cross-database boundary). policy_snapshot stores the EffectiveAlertPolicy actually '
  'executed so history stays explainable after configuration changes.';

-- ── 2. alert_event_state — the single mutable projection (ADR-0006) ───────────
CREATE TABLE IF NOT EXISTS alert_event_state (
  alert_key                 VARCHAR(255) PRIMARY KEY,
  organization_id           UUID NOT NULL,
  project_id                UUID,
  latest_event_id           UUID NOT NULL,
  state                     alert_state NOT NULL,
  severity                  logdb_severity NOT NULL,
  duplicate_count           INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  first_seen_at             TIMESTAMPTZ NOT NULL,
  last_seen_at              TIMESTAMPTZ NOT NULL,
  last_notified_at          TIMESTAMPTZ,
  acknowledged_by           UUID,
  acknowledged_at           TIMESTAMPTZ,
  acknowledgment_expires_at TIMESTAMPTZ,
  resolved_at               TIMESTAMPTZ,
  resolution_reason         VARCHAR(100),
  auto_resolve_at           TIMESTAMPTZ,
  escalation_policy_id      UUID,
  escalation_step_number    INTEGER NOT NULL DEFAULT 0 CHECK (escalation_step_number >= 0),
  escalation_repeat_count   INTEGER NOT NULL DEFAULT 0 CHECK (escalation_repeat_count >= 0),
  next_escalation_at        TIMESTAMPTZ,
  incident_id               UUID,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_event_state_active
  ON alert_event_state (organization_id, state, last_seen_at DESC)
  WHERE state IN ('pending','firing','acknowledged');
CREATE INDEX IF NOT EXISTS idx_alert_event_state_escalation
  ON alert_event_state (next_escalation_at)
  WHERE state = 'firing' AND next_escalation_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_event_state_autoresolve
  ON alert_event_state (auto_resolve_at)
  WHERE state = 'firing' AND auto_resolve_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_event_state_ack_expiry
  ON alert_event_state (acknowledgment_expires_at)
  WHERE state = 'acknowledged' AND acknowledgment_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_event_state_incident
  ON alert_event_state (incident_id)
  WHERE incident_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_alert_event_state_updated_at ON alert_event_state;
CREATE TRIGGER trg_alert_event_state_updated_at
  BEFORE UPDATE ON alert_event_state
  FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

COMMENT ON TABLE alert_event_state IS
  'The ONE documented mutable runtime projection (ADR-0006). Holds current alert '
  'lifecycle state; fully rebuildable from alert_events_v2 + alert_event_history_v2.';

-- ── 3. alert_event_history_v2 — append-only lifecycle audit ───────────────────
CREATE TABLE IF NOT EXISTS alert_event_history_v2 (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL,
  alert_key         VARCHAR(255) NOT NULL,
  alert_event_id    UUID,
  action            VARCHAR(64) NOT NULL,
  actor_type        VARCHAR(24) NOT NULL DEFAULT 'system',
  actor_user_id     UUID,
  previous_state    alert_state,
  new_state         alert_state,
  changes_summary   JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_alert_event_history_v2_actor CHECK (
    actor_type IN ('user','system','worker','api')
  )
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_event_history_v2_default
  PARTITION OF alert_event_history_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_alert_event_history_v2_alert
  ON alert_event_history_v2 (alert_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_event_history_v2_org
  ON alert_event_history_v2 (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_event_history_v2_event
  ON alert_event_history_v2 (alert_event_id, created_at DESC)
  WHERE alert_event_id IS NOT NULL;

-- ── 4. alert_rule_eval_state — evaluator breach/cooldown state ────────────────
-- Moves consecutive-breach + watermark state OFF the alert_rules config table
-- (04-evaluation-engines.md §3) so a 5s tier does not write a config row.
CREATE TABLE IF NOT EXISTS alert_rule_eval_state (
  scope_hash            VARCHAR(64) PRIMARY KEY,
  organization_id       UUID NOT NULL,
  rule_id               UUID NOT NULL,
  binding_id            UUID,
  project_id            UUID,
  environment           VARCHAR(64),
  service               VARCHAR(255),
  endpoint              VARCHAR(500),
  consecutive_breaches  INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_breaches >= 0),
  is_breaching          BOOLEAN NOT NULL DEFAULT FALSE,
  last_evaluated_at     TIMESTAMPTZ,
  last_fired_at         TIMESTAMPTZ,
  last_recovered_at     TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rule_eval_state_rule
  ON alert_rule_eval_state (rule_id);
CREATE INDEX IF NOT EXISTS idx_alert_rule_eval_state_due
  ON alert_rule_eval_state (organization_id, last_evaluated_at);

DROP TRIGGER IF EXISTS trg_alert_rule_eval_state_updated_at ON alert_rule_eval_state;
CREATE TRIGGER trg_alert_rule_eval_state_updated_at
  BEFORE UPDATE ON alert_rule_eval_state
  FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

-- ── 5. alert_notification_jobs — the contract handed to transport ─────────────
CREATE TABLE IF NOT EXISTS alert_notification_jobs (
  id                  UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL,
  project_id          UUID,
  alert_event_id      UUID NOT NULL,
  alert_key           VARCHAR(255) NOT NULL,
  channel_kind        notification_channel_kind NOT NULL,
  connector_id        UUID,
  route_id            UUID,
  recipient_user_id   UUID,
  recipient_ref       VARCHAR(320),
  template_id         UUID,
  severity            logdb_severity NOT NULL,
  priority            SMALLINT NOT NULL DEFAULT 0,
  escalation_step     SMALLINT NOT NULL DEFAULT 0 CHECK (escalation_step >= 0),
  attempt_epoch       SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_epoch >= 0),
  payload             JSONB NOT NULL,
  idempotency_key     VARCHAR(255) NOT NULL,
  status              notification_job_status NOT NULL DEFAULT 'pending',
  billable            BOOLEAN NOT NULL DEFAULT TRUE,
  notify_after        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_notification_jobs_default
  PARTITION OF alert_notification_jobs DEFAULT;

-- Zero duplicate notifications (success criterion).
CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_notification_jobs_idem
  ON alert_notification_jobs (organization_id, idempotency_key, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_notification_jobs_alert
  ON alert_notification_jobs (alert_event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_notification_jobs_pending
  ON alert_notification_jobs (status, created_at)
  WHERE status IN ('pending','queued');
CREATE INDEX IF NOT EXISTS idx_alert_notification_jobs_channel
  ON alert_notification_jobs (organization_id, channel_kind, created_at DESC);

COMMENT ON COLUMN alert_notification_jobs.idempotency_key IS
  'sha256(alert_key : channel_kind : recipient_ref : escalation_step : attempt_epoch)';

-- ── 6. alert_notification_ledger — replaces alert_throttle_windows (A3) ───────
CREATE TABLE IF NOT EXISTS alert_notification_ledger (
  id                  UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL,
  rule_id             UUID,
  rule_action_id      UUID,
  binding_id          UUID,
  alert_key           VARCHAR(255) NOT NULL,
  channel_kind        notification_channel_kind NOT NULL,
  recipient_user_id   UUID,
  notification_job_id UUID,
  notified_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, notified_at)
) PARTITION BY RANGE (notified_at);

CREATE TABLE IF NOT EXISTS alert_notification_ledger_default
  PARTITION OF alert_notification_ledger DEFAULT;

CREATE INDEX IF NOT EXISTS idx_alert_notification_ledger_action_window
  ON alert_notification_ledger (rule_action_id, notified_at DESC)
  WHERE rule_action_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_notification_ledger_alert_window
  ON alert_notification_ledger (alert_key, notified_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_notification_ledger_brin
  ON alert_notification_ledger USING BRIN (notified_at);

COMMENT ON TABLE alert_notification_ledger IS
  'Append-only notification ledger. Throttle decisions are derived by time-window '
  'aggregation (count / max(notified_at)) instead of upserting a mutable window row. '
  'Replaces alert_throttle_windows, which existed with two incompatible schemas.';

-- ── 7. alert_delivery_attempts_v2 — typed attempt fact (A2, B3) ───────────────
CREATE TABLE IF NOT EXISTS alert_delivery_attempts_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  project_id            UUID,
  alert_event_id        UUID NOT NULL,
  notification_job_id   UUID NOT NULL,
  channel_kind          notification_channel_kind NOT NULL,
  connector_id          UUID,
  route_id              UUID,
  recipient_user_id     UUID,
  attempt_number        SMALLINT NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
  status                notification_job_status NOT NULL,
  response_status_code  INTEGER,
  external_message_id   VARCHAR(255),
  error_category        VARCHAR(64),
  error_message         TEXT,
  latency_ms            INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_delivery_attempts_v2_default
  PARTITION OF alert_delivery_attempts_v2 DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_delivery_attempts_v2_idem
  ON alert_delivery_attempts_v2 (notification_job_id, attempt_number, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_v2_event
  ON alert_delivery_attempts_v2 (alert_event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_v2_connector
  ON alert_delivery_attempts_v2 (connector_id, status, created_at DESC)
  WHERE connector_id IS NOT NULL;

-- ── 8. alert_acknowledgments_v2 — append-only ack fact ────────────────────────
CREATE TABLE IF NOT EXISTS alert_acknowledgments_v2 (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL,
  alert_key         VARCHAR(255) NOT NULL,
  alert_event_id    UUID,
  acknowledged_by   UUID NOT NULL,
  expires_at        TIMESTAMPTZ,
  comment           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_acknowledgments_v2_default
  PARTITION OF alert_acknowledgments_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_alert_acknowledgments_v2_alert
  ON alert_acknowledgments_v2 (alert_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_acknowledgments_v2_org
  ON alert_acknowledgments_v2 (organization_id, created_at DESC);

COMMENT ON TABLE alert_acknowledgments_v2 IS
  'Append-only. The CURRENT acknowledgment lives on alert_event_state; this table is '
  'the immutable audit trail, so no partial-unique is_active index is required.';

-- ── 9. alert_metrics_v2 — derived runtime metric fact ─────────────────────────
CREATE TABLE IF NOT EXISTS alert_metrics_v2 (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL,
  project_id        UUID,
  rule_id           UUID,
  metric_name       VARCHAR(100) NOT NULL,
  metric_value      NUMERIC(20,6) NOT NULL,
  granularity       VARCHAR(16) NOT NULL DEFAULT 'hour',
  bucket            TIMESTAMPTZ NOT NULL,
  labels            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_alert_metrics_v2_granularity CHECK (
    granularity IN ('minute','hour','day','week','month')
  )
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_metrics_v2_default
  PARTITION OF alert_metrics_v2 DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_metrics_v2_bucket
  ON alert_metrics_v2 (organization_id, metric_name, granularity, bucket, rule_id, created_at)
  NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_alert_metrics_v2_query
  ON alert_metrics_v2 (organization_id, metric_name, bucket DESC);

-- ── 10. alert_dead_letter_events_v2 — typed DLQ fact ──────────────────────────
CREATE TABLE IF NOT EXISTS alert_dead_letter_events_v2 (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL,
  source_queue      VARCHAR(64) NOT NULL,
  pgboss_job_id     UUID,
  alert_event_id    UUID,
  notification_job_id UUID,
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message     TEXT,
  attempts          INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_retries       INTEGER NOT NULL DEFAULT 3 CHECK (max_retries >= 0),
  status            VARCHAR(24) NOT NULL DEFAULT 'pending_retry',
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_alert_dead_letter_events_v2_status CHECK (
    status IN ('pending_retry','retried','exhausted','discarded')
  )
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_dead_letter_events_v2_default
  PARTITION OF alert_dead_letter_events_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_alert_dead_letter_events_v2_status
  ON alert_dead_letter_events_v2 (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_dead_letter_events_v2_org
  ON alert_dead_letter_events_v2 (organization_id, created_at DESC);

COMMIT;

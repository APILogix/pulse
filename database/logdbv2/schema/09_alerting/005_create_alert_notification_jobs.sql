-- Outbound notification dispatch jobs (range-partitioned by created_at)
CREATE TABLE IF NOT EXISTS alert_notification_jobs (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  project_id            UUID,
  alert_event_id        UUID NOT NULL,
  alert_event_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  alert_key             VARCHAR(512),
  channel_kind          notification_channel_kind NOT NULL,
  rule_action_id        UUID,
  rule_id               UUID,
  binding_id            UUID,
  channel_id            UUID,
  connector_id          UUID,
  route_id              UUID,
  recipient_user_id     UUID,
  recipient_ref         TEXT,
  recipient_type        VARCHAR(64),
  template_id           UUID,
  severity              logdb_severity NOT NULL DEFAULT 'info',
  priority              SMALLINT NOT NULL DEFAULT 0,
  escalation_step       INTEGER NOT NULL DEFAULT 0,
  attempt_epoch         SMALLINT NOT NULL DEFAULT 0,
  status                notification_job_status NOT NULL DEFAULT 'pending',
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  recipients            JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key       VARCHAR(255) NOT NULL,
  billable              BOOLEAN NOT NULL DEFAULT true,
  notify_after          TIMESTAMPTZ,
  notification_type     VARCHAR(64) NOT NULL DEFAULT 'alert',
  routing_decision_hash VARCHAR(64),
  delivery_mode         VARCHAR(32),
  provider              VARCHAR(64),
  target_connector_id   UUID,
  target_route_id       UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS alert_notification_jobs_default PARTITION OF alert_notification_jobs DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_notification_jobs_idem
  ON alert_notification_jobs (organization_id, idempotency_key, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_notification_jobs_alert
  ON alert_notification_jobs (alert_event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_notification_jobs_pending
  ON alert_notification_jobs (status, priority DESC, created_at ASC)
  WHERE status IN ('pending','queued');
CREATE INDEX IF NOT EXISTS idx_alert_notification_jobs_channel
  ON alert_notification_jobs (organization_id, channel_kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_notification_jobs_project_channel
  ON alert_notification_jobs (organization_id, project_id, channel_id, created_at DESC)
  WHERE project_id IS NOT NULL AND channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_notification_jobs_rule
  ON alert_notification_jobs (organization_id, rule_id, binding_id, created_at DESC)
  WHERE rule_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_notification_jobs_delivery_mode
  ON alert_notification_jobs (organization_id, delivery_mode, status, created_at DESC)
  WHERE delivery_mode IS NOT NULL;

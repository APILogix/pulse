BEGIN;

CREATE TABLE IF NOT EXISTS organization_alert_thresholds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID,
  p50_threshold_ms INTEGER NOT NULL DEFAULT 300 CHECK (p50_threshold_ms > 0),
  p75_threshold_ms INTEGER NOT NULL DEFAULT 500 CHECK (p75_threshold_ms > 0),
  p90_threshold_ms INTEGER NOT NULL DEFAULT 800 CHECK (p90_threshold_ms > 0),
  p95_threshold_ms INTEGER NOT NULL DEFAULT 1000 CHECK (p95_threshold_ms > 0),
  p99_threshold_ms INTEGER NOT NULL DEFAULT 2000 CHECK (p99_threshold_ms > 0),
  p50_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  p75_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  p90_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  p95_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  p99_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  error_rate_threshold_percent NUMERIC(5,2) NOT NULL DEFAULT 5.00
    CHECK (error_rate_threshold_percent >= 0 AND error_rate_threshold_percent <= 100),
  error_rate_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  apdex_threshold NUMERIC(3,2) NOT NULL DEFAULT 0.85
    CHECK (apdex_threshold >= 0 AND apdex_threshold <= 1),
  apdex_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  evaluation_window_minutes INTEGER NOT NULL DEFAULT 5 CHECK (evaluation_window_minutes >= 1),
  cooldown_minutes INTEGER NOT NULL DEFAULT 30 CHECK (cooldown_minutes >= 0),
  alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  notify_emails TEXT[] NOT NULL DEFAULT '{}',
  last_alerted_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_alert_thresholds_scope
  ON organization_alert_thresholds(
    org_id,
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
CREATE INDEX IF NOT EXISTS idx_org_alert_thresholds_org
  ON organization_alert_thresholds(org_id);

DROP TRIGGER IF EXISTS trg_org_alert_thresholds_updated_at ON organization_alert_thresholds;
CREATE TRIGGER trg_org_alert_thresholds_updated_at
  BEFORE UPDATE ON organization_alert_thresholds
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

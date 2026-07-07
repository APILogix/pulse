BEGIN;

CREATE TABLE IF NOT EXISTS alert_rule_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  status VARCHAR(50) NOT NULL DEFAULT 'running',
  matched_count INTEGER NOT NULL DEFAULT 0,
  triggered_count INTEGER NOT NULL DEFAULT 0,
  suppressed_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  evaluation_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rule_executions_rule
  ON alert_rule_executions(rule_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_rule_executions_org
  ON alert_rule_executions(organization_id, started_at DESC);

COMMIT;

-- Evaluation checkpoints for scheduled alert rules
CREATE TABLE IF NOT EXISTS alert_rule_eval_state (
  rule_id               UUID PRIMARY KEY,
  organization_id       UUID NOT NULL,
  last_evaluated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_evaluation_duration_ms INTEGER,
  last_breach_detected_at TIMESTAMPTZ,
  consecutive_breaches  INTEGER NOT NULL DEFAULT 0,
  consecutive_clears    INTEGER NOT NULL DEFAULT 0,
  last_action_at        TIMESTAMPTZ,
  is_firing             BOOLEAN NOT NULL DEFAULT false,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rule_eval_state_due ON alert_rule_eval_state (organization_id, last_evaluated_at);

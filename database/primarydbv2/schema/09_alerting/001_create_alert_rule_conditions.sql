-- Normalized final definition for alert_rule_conditions.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/08_alerting/003_create_alert_rule_conditions.up.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS alert_rule_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  condition_type alert_condition_type NOT NULL DEFAULT 'threshold',
  condition_group_id UUID,
  field_path VARCHAR(500) NOT NULL,
  operator alert_condition_operator NOT NULL,
  threshold_value JSONB,
  lookback_minutes INTEGER,
  aggregate_function VARCHAR(50),
  sub_query JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rule_conditions_rule
  ON alert_rule_conditions(rule_id);

CREATE INDEX IF NOT EXISTS idx_alert_rule_conditions_group
  ON alert_rule_conditions(condition_group_id)
  WHERE condition_group_id IS NOT NULL;

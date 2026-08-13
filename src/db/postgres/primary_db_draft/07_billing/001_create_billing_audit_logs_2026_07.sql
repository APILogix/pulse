-- Normalized final definition for billing_audit_logs_2026_07.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/019_billing_audit_logs.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS billing_audit_logs_2026_07
PARTITION OF billing_audit_logs
FOR VALUES FROM (
  '2026-07-01'
) TO ('2026-08-01');

CREATE INDEX IF NOT EXISTS brin_bal_2026_07_time
ON billing_audit_logs_2026_07
USING BRIN(occurred_at);

CREATE INDEX IF NOT EXISTS gin_bal_2026_07_metadata
ON billing_audit_logs_2026_07
USING GIN(metadata);

CREATE INDEX IF NOT EXISTS gin_bal_2026_07_previous
ON billing_audit_logs_2026_07
USING GIN(previous_state);

CREATE INDEX IF NOT EXISTS gin_bal_2026_07_new
ON billing_audit_logs_2026_07
USING GIN(new_state);

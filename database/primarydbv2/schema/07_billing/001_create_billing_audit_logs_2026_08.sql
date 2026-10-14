-- Normalized final definition for billing_audit_logs_2026_08.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/019_billing_audit_logs.sql
-- - canonical_migrations_draft/11_billing/043_billing_audit_log_partition_safety.sql

CREATE TABLE IF NOT EXISTS billing_audit_logs_2026_08
PARTITION OF billing_audit_logs
FOR VALUES FROM (
  '2026-08-01'
) TO ('2026-09-01');

CREATE INDEX IF NOT EXISTS brin_bal_2026_08_time
ON billing_audit_logs_2026_08
USING BRIN(occurred_at);

CREATE INDEX IF NOT EXISTS gin_bal_2026_08_metadata
ON billing_audit_logs_2026_08
USING GIN(metadata);

CREATE INDEX IF NOT EXISTS gin_bal_2026_08_previous
ON billing_audit_logs_2026_08
USING GIN(previous_state);

CREATE INDEX IF NOT EXISTS gin_bal_2026_08_new
ON billing_audit_logs_2026_08
USING GIN(new_state);

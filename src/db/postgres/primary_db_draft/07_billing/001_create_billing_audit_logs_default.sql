-- Normalized final definition for billing_audit_logs_default.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/019_billing_audit_logs.sql
-- - canonical_migrations_draft/11_billing/043_billing_audit_log_partition_safety.sql

CREATE TABLE IF NOT EXISTS billing_audit_logs_default
PARTITION OF billing_audit_logs
DEFAULT;

CREATE INDEX IF NOT EXISTS brin_bal_default_time
ON billing_audit_logs_default
USING BRIN(occurred_at);

CREATE INDEX IF NOT EXISTS gin_bal_default_metadata
ON billing_audit_logs_default
USING GIN(metadata);

CREATE INDEX IF NOT EXISTS gin_bal_default_previous
ON billing_audit_logs_default
USING GIN(previous_state);

CREATE INDEX IF NOT EXISTS gin_bal_default_new
ON billing_audit_logs_default
USING GIN(new_state);

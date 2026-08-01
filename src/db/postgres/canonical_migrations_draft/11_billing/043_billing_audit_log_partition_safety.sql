-- =============================================================================
-- Module      : Billing
-- Migration   : 043_billing_audit_log_partition_safety.sql
-- Description : Backfill billing audit partitions after July 2026 rollover
-- PostgreSQL  : 16+
-- Depends On  : 019_billing_audit_logs.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS billing_audit_logs_2026_08
PARTITION OF billing_audit_logs
FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE TABLE IF NOT EXISTS billing_audit_logs_default
PARTITION OF billing_audit_logs
DEFAULT;

CREATE INDEX IF NOT EXISTS idx_bal_2026_08_org_time
ON billing_audit_logs_2026_08(organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_bal_default_org_time
ON billing_audit_logs_default(organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_bal_2026_08_action
ON billing_audit_logs_2026_08(action, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_bal_default_action
ON billing_audit_logs_default(action, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_bal_2026_08_actor
ON billing_audit_logs_2026_08(actor_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_bal_default_actor
ON billing_audit_logs_default(actor_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_bal_2026_08_request
ON billing_audit_logs_2026_08(request_id)
WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bal_default_request
ON billing_audit_logs_default(request_id)
WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS brin_bal_2026_08_time
ON billing_audit_logs_2026_08
USING BRIN(occurred_at);

CREATE INDEX IF NOT EXISTS brin_bal_default_time
ON billing_audit_logs_default
USING BRIN(occurred_at);

CREATE INDEX IF NOT EXISTS gin_bal_2026_08_metadata
ON billing_audit_logs_2026_08
USING GIN(metadata);

CREATE INDEX IF NOT EXISTS gin_bal_default_metadata
ON billing_audit_logs_default
USING GIN(metadata);

CREATE INDEX IF NOT EXISTS gin_bal_2026_08_previous
ON billing_audit_logs_2026_08
USING GIN(previous_state);

CREATE INDEX IF NOT EXISTS gin_bal_default_previous
ON billing_audit_logs_default
USING GIN(previous_state);

CREATE INDEX IF NOT EXISTS gin_bal_2026_08_new
ON billing_audit_logs_2026_08
USING GIN(new_state);

CREATE INDEX IF NOT EXISTS gin_bal_default_new
ON billing_audit_logs_default
USING GIN(new_state);

COMMIT;

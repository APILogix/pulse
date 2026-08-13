-- Normalized final definition for connector_audit_logs_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS connector_audit_logs_default
PARTITION OF connector_audit_logs DEFAULT;

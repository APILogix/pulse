-- Normalized final definition for metrics_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS metrics_default PARTITION OF metrics DEFAULT;

-- Normalized final definition for connector_health_checks_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS connector_health_checks_default
PARTITION OF connector_health_checks DEFAULT;

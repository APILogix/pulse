-- Normalized final definition for connector_deliveries_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS connector_deliveries_default
PARTITION OF connector_deliveries DEFAULT;

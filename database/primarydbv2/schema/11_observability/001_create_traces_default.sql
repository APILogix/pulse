-- Normalized final definition for traces_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS traces_default PARTITION OF traces DEFAULT;

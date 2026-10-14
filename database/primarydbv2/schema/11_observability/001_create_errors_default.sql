-- Normalized final definition for errors_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS errors_default PARTITION OF errors DEFAULT;

-- Normalized final definition for logs_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS logs_default PARTITION OF logs DEFAULT;

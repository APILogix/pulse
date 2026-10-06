-- Normalized final definition for spans_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS spans_default PARTITION OF spans DEFAULT;

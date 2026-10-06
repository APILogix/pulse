-- Normalized final definition for messages_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS messages_default PARTITION OF messages DEFAULT;

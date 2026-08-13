-- Normalized final definition for replays_default.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS replays_default PARTITION OF replays DEFAULT;

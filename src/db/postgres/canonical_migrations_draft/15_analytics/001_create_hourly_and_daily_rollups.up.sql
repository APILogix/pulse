BEGIN;

-- Log DB schema moved to database/migrations/logdb. This primary DB migration is intentionally a no-op to prevent duplicate runtime table definitions.
-- Original file: src/db/postgres/canonical_migrations_draft/15_analytics/001_create_hourly_and_daily_rollups.up.sql

COMMIT;


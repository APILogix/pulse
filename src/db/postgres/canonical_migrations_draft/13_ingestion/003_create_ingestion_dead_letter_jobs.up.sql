BEGIN;

-- Log DB schema moved to database/migrations/logdb. This primary DB migration is intentionally a no-op to prevent duplicate runtime table definitions.
-- Original file: src/db/postgres/canonical_migrations_draft/13_ingestion/003_create_ingestion_dead_letter_jobs.up.sql

COMMIT;


BEGIN;

-- Log DB schema moved to database/migrations/logdb. This primary DB migration is intentionally a no-op to prevent duplicate runtime table definitions.
-- Original file: src/db/postgres/canonical_migrations_draft/16_legacy_compat/003_create_legacy_failure_tables.up.sql

COMMIT;


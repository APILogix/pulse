BEGIN;

-- Log DB schema moved to database/migrations/logdb. This primary DB migration is intentionally a no-op to prevent duplicate runtime table definitions.
-- Original file: src/db/postgres/canonical_migrations_draft/08_alerting/015_create_alert_rule_executions.up.sql

COMMIT;


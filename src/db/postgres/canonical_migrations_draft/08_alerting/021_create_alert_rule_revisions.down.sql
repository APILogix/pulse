-- =============================================================================
-- Primary DB : P3 rollback — alert_rule_revisions
--
-- Safe during Increment 2: nothing reads revisions yet.
-- DESTRUCTIVE for rule version history only; alert_rules rows are untouched apart from
-- dropping the current_revision pointer column.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS alert_rule_revisions;

ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS ck_alert_rules_current_revision;
ALTER TABLE alert_rules DROP COLUMN IF EXISTS current_revision;

DELETE FROM schema_migrations
 WHERE filename LIKE '%021_create_alert_rule_revisions.up.sql';

COMMIT;

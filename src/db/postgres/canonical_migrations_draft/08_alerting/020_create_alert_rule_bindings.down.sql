-- =============================================================================
-- Primary DB : P2 rollback — alert_rule_bindings
--
-- Safe at any time during Increment 2: no evaluator reads this table, and
-- alert_rules.project_id was never modified, so rule behaviour is unaffected.
--
-- DESTRUCTIVE for binding configuration only. If bindings were created by hand (not the
-- P12 backfill) they are lost; to remove ONLY backfilled rows use
--   DELETE FROM alert_rule_bindings WHERE notes = 'backfill:v2';
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS alert_rule_bindings;

DELETE FROM schema_migrations
 WHERE filename LIKE '%020_create_alert_rule_bindings.up.sql';

COMMIT;

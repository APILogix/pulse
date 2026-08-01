-- =============================================================================
-- Primary DB : P12 rollback — remove backfilled bindings and seeded revisions
-- Architecture : docs/alerting-redesign/07-migration-plan.md §3, §8
--
-- Removes ONLY rows this backfill created, identified by the `backfill:v2` marker and the
-- `snapshot->>'backfill'` flag. Hand-created bindings and real revision history are left
-- untouched, which is why the marker exists.
--
-- Safe at any time during Increment 2: no evaluator reads bindings, and alert_rules was
-- never modified apart from the current_revision pointer added by P3.
-- =============================================================================

BEGIN;

DELETE FROM alert_rule_bindings
 WHERE notes = 'backfill:v2';

DELETE FROM alert_rule_revisions
 WHERE revision = 1
   AND change_kind = 'rule'
   AND snapshot->>'backfill' = 'true';

DELETE FROM schema_migrations
 WHERE filename LIKE '%025_backfill_rule_bindings.up.sql';

COMMIT;

-- =============================================================================
-- Primary DB : P7 rollback — Global connector runtime guards
--
-- Safe at any time while CONNECTOR_GLOBAL_LIMITS is off (Increment 1–6): nothing
-- reads these tables, so dropping them restores exactly the pre-migration state.
-- After Increment 7 is enabled, disable the flag BEFORE running this rollback so
-- connector workers fall back to the in-process pre-filter limiter.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS connector_circuit_state;
DROP TABLE IF EXISTS connector_rate_buckets;

DELETE FROM schema_migrations
 WHERE filename LIKE '%015_create_connector_runtime_guards.up.sql';

COMMIT;

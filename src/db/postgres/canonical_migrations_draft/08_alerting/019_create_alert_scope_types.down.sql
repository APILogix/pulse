-- =============================================================================
-- Primary DB : P1 rollback — Alert scope / binding enums
--
-- Run AFTER 020 (bindings) has been rolled back: those columns depend on these types.
-- DROP TYPE without CASCADE is deliberate — it fails loudly if a dependent column
-- still exists rather than silently dropping configuration.
--
-- notification_channel_kind is dropped last because alert_channel_bindings (P4,
-- Increment 3) will also depend on it once that migration exists.
-- =============================================================================

BEGIN;

DROP TYPE IF EXISTS alert_action_merge_mode;
DROP TYPE IF EXISTS alert_binding_mode;
DROP TYPE IF EXISTS alert_scope_type;
DROP TYPE IF EXISTS notification_channel_kind;

DELETE FROM schema_migrations
 WHERE filename LIKE '%019_create_alert_scope_types.up.sql';

COMMIT;

BEGIN;

-- =============================================================================
-- Remove the database-side SDK configuration provisioning trigger.
--
-- SDK configurations are now provisioned EXPLICITLY inside the application
-- service-layer transaction (see SdkConfigProvisioner). Provisioning an
-- environment and seeding its published revision #1 happen atomically in the
-- same transaction that creates the environment, keeping the behavior explicit,
-- testable, and maintainable. Business logic must not live in the database.
--
-- What this migration does NOT touch:
--   * The revision immutability trigger
--     (trg_project_environment_sdk_revisions_immutable) — revisions remain
--     append-only.
--   * The `pulse_build_initial_sdk_config` helper is retained so the down
--     migration can fully restore the previous trigger-based behavior.
--   * Ownership constraints: one head per environment (UNIQUE(environment_id))
--     and ON DELETE CASCADE from project_environments remain in force, so SDK
--     configurations still cannot exist without their environment and are
--     removed with it.
-- =============================================================================

DROP TRIGGER IF EXISTS trg_project_environments_sdk_config ON project_environments;
DROP FUNCTION IF EXISTS provision_environment_sdk_config();

COMMIT;

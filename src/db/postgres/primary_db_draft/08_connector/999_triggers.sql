-- Source: canonical_migrations_draft/06_connectors/015_create_connector_runtime_guards.up.sql
DROP TRIGGER IF EXISTS trg_connector_circuit_state_updated_at ON connector_circuit_state;
CREATE TRIGGER trg_connector_circuit_state_updated_at
  BEFORE UPDATE ON connector_circuit_state
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/06_connectors/015_create_connector_runtime_guards.up.sql
DROP TRIGGER IF EXISTS trg_connector_rate_buckets_updated_at ON connector_rate_buckets;
CREATE TRIGGER trg_connector_rate_buckets_updated_at
  BEFORE UPDATE ON connector_rate_buckets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/003_project_module_refactor.sql
DROP TRIGGER IF EXISTS trg_project_connector_subs_updated_at ON project_connector_subscriptions;
CREATE TRIGGER trg_project_connector_subs_updated_at
  BEFORE UPDATE ON project_connector_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

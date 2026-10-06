-- Error groups triggers
DROP TRIGGER IF EXISTS trg_sync_error_groups_contract ON error_groups;
CREATE TRIGGER trg_sync_error_groups_contract
  BEFORE INSERT OR UPDATE ON error_groups
  FOR EACH ROW EXECUTE FUNCTION logdb_sync_error_groups_contract();

DROP TRIGGER IF EXISTS trg_sync_error_groups_contract ON analytics_error_groups;
CREATE TRIGGER trg_sync_error_groups_contract
  BEFORE INSERT OR UPDATE ON analytics_error_groups
  FOR EACH ROW EXECUTE FUNCTION logdb_sync_error_groups_contract();

DROP TRIGGER IF EXISTS trg_analytics_error_groups_updated_at ON analytics_error_groups;
CREATE TRIGGER trg_analytics_error_groups_updated_at
  BEFORE UPDATE ON analytics_error_groups
  FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

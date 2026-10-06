-- Analytics triggers
DROP TRIGGER IF EXISTS trg_sync_user_sessions_contract ON analytics_user_sessions;
CREATE TRIGGER trg_sync_user_sessions_contract
  BEFORE INSERT OR UPDATE ON analytics_user_sessions
  FOR EACH ROW EXECUTE FUNCTION logdb_sync_user_sessions_contract();

DROP TRIGGER IF EXISTS trg_logdb_dashboards_updated_at ON analytics_dashboards;
CREATE TRIGGER trg_logdb_dashboards_updated_at
  BEFORE UPDATE ON analytics_dashboards
  FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

DROP TRIGGER IF EXISTS trg_logdb_saved_queries_updated_at ON analytics_saved_queries;
CREATE TRIGGER trg_logdb_saved_queries_updated_at
  BEFORE UPDATE ON analytics_saved_queries
  FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

DROP TRIGGER IF EXISTS trg_logdb_analytics_alerts_updated_at ON analytics_alerts;
CREATE TRIGGER trg_logdb_analytics_alerts_updated_at
  BEFORE UPDATE ON analytics_alerts
  FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

DROP TRIGGER IF EXISTS trg_analytics_watermarks_updated_at ON analytics_watermarks;
CREATE TRIGGER trg_analytics_watermarks_updated_at
  BEFORE UPDATE ON analytics_watermarks
  FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

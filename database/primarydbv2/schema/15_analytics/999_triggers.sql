-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_analytics_alerts_updated_at ON analytics_alerts;
CREATE TRIGGER trg_analytics_alerts_updated_at
  BEFORE UPDATE ON analytics_alerts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_daily_rollup_updated_at ON analytics_daily_rollup;
CREATE TRIGGER trg_daily_rollup_updated_at
  BEFORE UPDATE ON analytics_daily_rollup
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_dashboards_updated_at ON analytics_dashboards;
CREATE TRIGGER trg_dashboards_updated_at
  BEFORE UPDATE ON analytics_dashboards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_error_groups_updated_at ON analytics_error_groups;
CREATE TRIGGER trg_error_groups_updated_at
  BEFORE UPDATE ON analytics_error_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_hourly_rollup_updated_at ON analytics_hourly_rollup;
CREATE TRIGGER trg_hourly_rollup_updated_at
  BEFORE UPDATE ON analytics_hourly_rollup
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_perf_summary_updated_at ON analytics_performance_summary;
CREATE TRIGGER trg_perf_summary_updated_at
  BEFORE UPDATE ON analytics_performance_summary
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_saved_queries_updated_at ON analytics_saved_queries;
CREATE TRIGGER trg_saved_queries_updated_at
  BEFORE UPDATE ON analytics_saved_queries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

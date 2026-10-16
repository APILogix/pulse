-- ============================================================================
-- 001_pg_stat_statements.sql
-- Enable and configure pg_stat_statements extension for PostgreSQL 16/17
-- Applies to BOTH PrimaryDB (Control-Plane) and LogDB (Telemetry / TimescaleDB)
-- ============================================================================

-- Ensure the extension is installed in the public schema
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA public;

-- Grant execution/read permissions to monitoring/application roles
DO $$
BEGIN
  -- Grant pg_read_all_stats to the application user if role exists
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulse_app') THEN
    GRANT pg_read_all_stats TO pulse_app;
  END IF;

  -- Grant to pulse_monitoring role for automated top-query reporting scripts
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulse_monitoring') THEN
    GRANT pg_read_all_stats TO pulse_monitoring;
  END IF;
END $$;

-- Verify extension installation
SELECT
  extname,
  extversion,
  extnamespace::regnamespace AS schema
FROM pg_extension
WHERE extname = 'pg_stat_statements';

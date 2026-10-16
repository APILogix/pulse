-- ============================================================================
-- 002_monitoring_roles_and_timeouts.sql
-- Dedicated Monitoring Roles and Tiered Timeout Policies
-- ============================================================================

-- 1. Create Dedicated Least-Privilege Monitoring Role
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulse_monitoring') THEN
    CREATE ROLE pulse_monitoring WITH LOGIN PASSWORD 'change_in_production_env';
  END IF;
END $$;

-- Grant built-in PostgreSQL read-only monitoring privileges
GRANT pg_monitor TO pulse_monitoring;
GRANT pg_read_all_stats TO pulse_monitoring;

-- 2. CONTROL-PLANE DATABASE (PrimaryDB / pulse_primary)
-- Aggressive timeouts to prevent connection starvation on control plane
DO $$
BEGIN
  IF current_database() = 'pulse_primary' OR current_database() = 'pulse' THEN
    -- Global database-level fallbacks
    ALTER DATABASE current_database() SET statement_timeout = '10s';
    ALTER DATABASE current_database() SET idle_in_transaction_session_timeout = '30s';

    -- Specific application role timeouts
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulse_app') THEN
      ALTER ROLE pulse_app SET statement_timeout = '10s';
      ALTER ROLE pulse_app SET idle_in_transaction_session_timeout = '30s';
    END IF;

    -- Monitoring role can run slightly longer diagnostics
    ALTER ROLE pulse_monitoring SET statement_timeout = '15s';
  END IF;
END $$;

-- 3. TELEMETRY DATABASE (LogDB / TimescaleDB / pulse_logdb)
-- Tiered timeouts by operational workload: Ingest, Analytics, and Rollups
DO $$
BEGIN
  IF current_database() = 'pulse_logdb' OR current_database() = 'pulse_telemetry' THEN
    -- Global fallback
    ALTER DATABASE current_database() SET idle_in_transaction_session_timeout = '60s';

    -- Ingestion role: short bounded timeout to fail-fast if tables are locked
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulse_ingest') THEN
      ALTER ROLE pulse_ingest SET statement_timeout = '5s';
      ALTER ROLE pulse_ingest SET idle_in_transaction_session_timeout = '15s';
    END IF;

    -- Analytics / Dashboard reads: bounded to 30s to prevent zombie query saturation
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulse_analytics') THEN
      ALTER ROLE pulse_analytics SET statement_timeout = '30s';
      ALTER ROLE pulse_analytics SET idle_in_transaction_session_timeout = '30s';
    END IF;

    -- Application user default
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulse_app') THEN
      ALTER ROLE pulse_app SET statement_timeout = '30s';
      ALTER ROLE pulse_app SET idle_in_transaction_session_timeout = '45s';
    END IF;

    -- Background rollup / continuous aggregate workers: allow 120s
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulse_worker') THEN
      ALTER ROLE pulse_worker SET statement_timeout = '120s';
      ALTER ROLE pulse_worker SET idle_in_transaction_session_timeout = '60s';
    END IF;

    -- Monitoring role
    ALTER ROLE pulse_monitoring SET statement_timeout = '30s';
  END IF;
END $$;

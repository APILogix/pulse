BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_severity') THEN
    CREATE TYPE event_severity AS ENUM ('debug', 'info', 'warning', 'error', 'fatal');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'span_status') THEN
    CREATE TYPE span_status AS ENUM ('ok', 'error', 'unset');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'span_kind') THEN
    CREATE TYPE span_kind AS ENUM ('internal', 'server', 'client', 'producer', 'consumer');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'analytics_metric_type') THEN
    CREATE TYPE analytics_metric_type AS ENUM ('counter', 'gauge', 'histogram');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'log_level') THEN
    CREATE TYPE log_level AS ENUM ('debug', 'info', 'warn', 'error');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cron_status') THEN
    CREATE TYPE cron_status AS ENUM ('ok', 'error', 'in_progress');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'error_group_status') THEN
    CREATE TYPE error_group_status AS ENUM ('unresolved', 'resolved', 'ignored', 'muted');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rollup_granularity') THEN
    CREATE TYPE rollup_granularity AS ENUM ('hour', 'day', 'week', 'month');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'analytics_alert_operator') THEN
    CREATE TYPE analytics_alert_operator AS ENUM ('gt', 'lt', 'eq', 'gte', 'lte');
  END IF;
END $$;

COMMIT;

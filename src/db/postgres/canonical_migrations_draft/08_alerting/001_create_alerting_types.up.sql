BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_severity') THEN
    CREATE TYPE alert_severity AS ENUM ('info', 'warning', 'error', 'critical');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_status') THEN
    CREATE TYPE alert_status AS ENUM ('firing', 'resolved', 'acknowledged', 'suppressed', 'silenced', 'pending');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_condition_type') THEN
    CREATE TYPE alert_condition_type AS ENUM ('threshold', 'change', 'anomaly', 'static', 'composite');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_condition_operator') THEN
    CREATE TYPE alert_condition_operator AS ENUM ('gt', 'lt', 'gte', 'lte', 'eq', 'neq', 'contains', 'regex', 'in', 'exists');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_action_type') THEN
    CREATE TYPE alert_action_type AS ENUM ('notify', 'webhook', 'suppress', 'escalate', 'group');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_event_status') THEN
    CREATE TYPE alert_event_status AS ENUM ('pending', 'processing', 'firing', 'resolved', 'acknowledged', 'suppressed', 'silenced', 'error');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_attempt_status') THEN
    CREATE TYPE delivery_attempt_status AS ENUM ('pending', 'queued', 'sent', 'delivered', 'failed', 'retrying', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'batch_status') THEN
    CREATE TYPE batch_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'partial');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'history_action') THEN
    CREATE TYPE history_action AS ENUM ('triggered', 'acknowledged', 'resolved', 'escalated', 'suppressed', 'notified', 'silenced', 'grouped', 'auto_resolved', 'rule_modified');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'metric_granularity') THEN
    CREATE TYPE metric_granularity AS ENUM ('hour', 'day', 'week', 'month');
  END IF;
END $$;

COMMIT;

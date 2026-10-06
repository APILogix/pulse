-- LogDB enums and shared domain types
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'logdb_job_state') THEN
    CREATE TYPE logdb_job_state AS ENUM ('pending', 'active', 'completed', 'failed', 'dead_letter', 'cancelled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'logdb_severity') THEN
    CREATE TYPE logdb_severity AS ENUM ('debug', 'info', 'warning', 'error', 'critical', 'fatal');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'logdb_delivery_status') THEN
    CREATE TYPE logdb_delivery_status AS ENUM ('pending', 'delivered', 'failed', 'retrying', 'discarded');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'logdb_ai_status') THEN
    CREATE TYPE logdb_ai_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_channel_kind') THEN
    CREATE TYPE notification_channel_kind AS ENUM (
      'in_app','email','slack','discord','teams','pagerduty','webhook','sms'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_event_kind') THEN
    CREATE TYPE alert_event_kind AS ENUM (
      'fired','recovered','duplicate','suppressed','silenced'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_state') THEN
    CREATE TYPE alert_state AS ENUM (
      'pending','firing','acknowledged','resolved','suppressed','silenced','expired','error'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_job_status') THEN
    CREATE TYPE notification_job_status AS ENUM (
      'pending','queued','sent','failed','suppressed','cancelled','expired'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_usage_kind') THEN
    CREATE TYPE alert_usage_kind AS ENUM (
      'alert_generated','alert_suppressed','alert_delivered','alert_failed',
      'connector_send','email_sent','slack_message','sms_sent','webhook_call',
      'discord_message','teams_message','pagerduty_event','delivery_retry'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'analytics_alert_operator') THEN
    CREATE TYPE analytics_alert_operator AS ENUM ('gt', 'lt', 'eq', 'gte', 'lte');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'connector_delivery_status_v2') THEN
    CREATE TYPE connector_delivery_status_v2 AS ENUM (
      'pending','queued','sent','retrying','failed','suppressed','cancelled'
    );
  END IF;
END $$;

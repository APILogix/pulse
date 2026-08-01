-- =============================================================================
-- Log DB : L1 — Alerting v2 runtime enums
-- Architecture : docs/alerting-redesign/02-data-model.md §3, §7
--                docs/alerting-redesign/adr/0006-database-ownership.md
-- Increment    : 1 (schema ownership stabilization)
--
-- Additive only. Creates the enum vocabulary shared by the typed v2 runtime
-- tables. `notification_channel_kind` is intentionally created with the SAME
-- name and SAME value order in BOTH databases so payloads translate 1:1 with
-- no mapping table (02-data-model.md §5).
-- =============================================================================

BEGIN;

DO $$
BEGIN
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
END $$;

INSERT INTO logdb_schema_notes(subject, decision) VALUES
  (
    'alerting_v2_runtime',
    'Alert and connector runtime facts are owned by the Log DB and are append-oriented. '
    || 'alert_event_state is the single documented mutable projection (ADR-0006) and is '
    || 'rebuildable from alert_events_v2 + alert_event_history_v2.'
  )
ON CONFLICT (subject) DO UPDATE SET decision = EXCLUDED.decision;

COMMIT;

-- =============================================================================
-- Module      : Enterprise Ingestion
-- Migration   : 001_events_idempotency.up.sql
-- Description : Idempotent insert support for all events_* tables.
--
-- The ingestion platform processes jobs at-least-once (pg-boss retries, queue
-- replay, SDK retries, worker crashes). To make duplicate delivery harmless,
-- every events_* table gets a unique identity index on (project_id, event_id)
-- so writers can INSERT ... ON CONFLICT DO NOTHING.
--
-- NULLS NOT DISTINCT makes org-level events (project_id IS NULL) idempotent
-- as well (PostgreSQL 15+; platform targets PG 17).
--
-- Justification: without a database-level uniqueness guarantee, idempotency
-- depends on application discipline alone and breaks under concurrent worker
-- retries racing on the same job payload.
-- =============================================================================

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_errors_project_event
  ON events_errors(project_id, event_id) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_requests_project_event
  ON events_requests(project_id, event_id) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_spans_project_event
  ON events_spans(project_id, event_id) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_metrics_project_event
  ON events_metrics(project_id, event_id) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_messages_project_event
  ON events_messages(project_id, event_id) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_traces_project_event
  ON events_traces(project_id, event_id) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_logs_project_event
  ON events_logs(project_id, event_id) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_profiles_project_event
  ON events_profiles(project_id, event_id) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_cron_checkins_project_event
  ON events_cron_checkins(project_id, event_id) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_replays_project_event
  ON events_replays(project_id, event_id) NULLS NOT DISTINCT;

COMMIT;

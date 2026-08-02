BEGIN;

DROP TABLE IF EXISTS
  events_cron_checkins,
  events_replays,
  events_profiles,
  events_messages,
  events_traces,
  events_spans,
  events_metrics,
  events_logs,
  events_errors,
  events_requests
CASCADE;

DROP FUNCTION IF EXISTS logdb_sync_typed_event_contract() CASCADE;

COMMIT;

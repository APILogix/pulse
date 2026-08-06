BEGIN;

-- Unique event guard for idempotent error ingestion.
-- Matches the ON CONFLICT (organization_id, event_id, occurred_at) clause used by ErrorRepository.
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_errors_event_unique
  ON events_errors (organization_id, event_id, occurred_at);

COMMIT;

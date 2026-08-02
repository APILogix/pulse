BEGIN;

ALTER TABLE events_requests
    ADD COLUMN IF NOT EXISTS endpoint TEXT,
    ADD COLUMN IF NOT EXISTS name TEXT,
    ADD COLUMN IF NOT EXISTS duration_ms NUMERIC(14,3),
    ADD COLUMN IF NOT EXISTS attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS response_size BIGINT,
    ADD COLUMN IF NOT EXISTS server_name TEXT,
    ADD COLUMN IF NOT EXISTS application_name TEXT,
    ADD COLUMN IF NOT EXISTS application_version TEXT,
    ADD COLUMN IF NOT EXISTS sdk_name TEXT,
    ADD COLUMN IF NOT EXISTS sdk_version TEXT,
    ADD COLUMN IF NOT EXISTS release TEXT,
    ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ;

UPDATE events_requests
SET
    attributes = COALESCE(attributes, '{}'::jsonb)
WHERE attributes IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_requests_endpoint_time
ON events_requests (
    organization_id,
    project_id,
    endpoint,
    timestamp DESC
);

CREATE INDEX IF NOT EXISTS idx_events_requests_duration_time
ON events_requests (
    organization_id,
    project_id,
    duration_ms,
    timestamp DESC
)
WHERE duration_ms IS NOT NULL;

COMMIT;
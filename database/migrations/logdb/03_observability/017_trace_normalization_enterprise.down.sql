BEGIN;

ALTER TABLE events_spans
  DROP COLUMN IF EXISTS organization_id,
  DROP COLUMN IF EXISTS project_id,
  DROP COLUMN IF EXISTS request_id,
  DROP COLUMN IF EXISTS created_at,
  DROP COLUMN IF EXISTS ingested_at;

DROP INDEX IF EXISTS idx_traces_org_proj_time;
DROP INDEX IF EXISTS idx_traces_trace_id_hash;
DROP INDEX IF EXISTS idx_traces_endpoint;
DROP INDEX IF EXISTS idx_traces_status_code;

ALTER TABLE events_traces
  DROP COLUMN IF EXISTS parent_span_id,
  DROP COLUMN IF EXISTS endpoint,
  DROP COLUMN IF EXISTS http_method,
  DROP COLUMN IF EXISTS status_code,
  DROP COLUMN IF EXISTS duration_ms,
  DROP COLUMN IF EXISTS response_size,
  DROP COLUMN IF EXISTS span_kind,
  DROP COLUMN IF EXISTS root_span_status,
  DROP COLUMN IF EXISTS user_agent,
  DROP COLUMN IF EXISTS client_ip_hash,
  DROP COLUMN IF EXISTS occurred_at,
  DROP COLUMN IF EXISTS ingested_at,
  DROP COLUMN IF EXISTS payload,
  DROP COLUMN IF EXISTS metadata,
  DROP COLUMN IF EXISTS attributes;

COMMIT;

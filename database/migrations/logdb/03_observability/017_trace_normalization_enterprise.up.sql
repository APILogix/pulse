BEGIN;

ALTER TABLE events_traces
  ADD COLUMN IF NOT EXISTS parent_span_id TEXT,
  ADD COLUMN IF NOT EXISTS endpoint TEXT,
  ADD COLUMN IF NOT EXISTS http_method TEXT,
  ADD COLUMN IF NOT EXISTS status_code INTEGER,
  ADD COLUMN IF NOT EXISTS duration_ms NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS response_size BIGINT,
  ADD COLUMN IF NOT EXISTS span_kind TEXT,
  ADD COLUMN IF NOT EXISTS root_span_status TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS client_ip_hash TEXT,
  ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS attributes JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Populate occurred_at from timestamp if missing
UPDATE events_traces SET occurred_at = timestamp WHERE occurred_at IS NULL;
ALTER TABLE events_traces ALTER COLUMN occurred_at SET NOT NULL;

-- Create Indexes
CREATE INDEX IF NOT EXISTS idx_traces_org_proj_time ON events_traces(organization_id, project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_traces_trace_id_hash ON events_traces(trace_id);
CREATE INDEX IF NOT EXISTS idx_traces_endpoint ON events_traces(organization_id, project_id, endpoint, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_traces_status_code ON events_traces(organization_id, project_id, status_code, occurred_at DESC);

-- Ensure events_spans has canonical enterprise columns
ALTER TABLE events_spans
  ADD COLUMN IF NOT EXISTS organization_id UUID,
  ADD COLUMN IF NOT EXISTS project_id UUID,
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMPTZ DEFAULT NOW();

COMMIT;

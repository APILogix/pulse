CREATE TABLE IF NOT EXISTS error_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  fingerprint VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  occurrence_count BIGINT NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_event_id VARCHAR(64) NOT NULL,
  latest_event_id VARCHAR(64) NOT NULL,
  highest_severity VARCHAR(16) NOT NULL,
  latest_severity VARCHAR(16) NOT NULL,
  
  is_regression BOOLEAN NOT NULL DEFAULT FALSE,
  regression_count INTEGER NOT NULL DEFAULT 0,
  last_regressed_at TIMESTAMPTZ,
  
  latest_release VARCHAR(100),
  latest_sdk_version VARCHAR(50),
  latest_application_version VARCHAR(50),

  -- Group Snapshot
  last_error_message TEXT,
  last_error_name VARCHAR(255),
  last_status_code INTEGER,
  last_trace_id VARCHAR(64),
  last_request_id VARCHAR(64),

  -- Merge Support
  merged_into UUID NULL,
  is_merged BOOLEAN DEFAULT FALSE,

  -- Versioning (Optimistic Locking)
  version INTEGER NOT NULL DEFAULT 1,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_error_groups_project_fingerprint UNIQUE (project_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_error_groups_project_status_last_seen
  ON error_groups(project_id, status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_groups_project_occurrence
  ON error_groups(project_id, occurrence_count DESC);

ALTER TABLE events_errors
  ADD COLUMN IF NOT EXISTS error_group_id UUID;
  
CREATE INDEX IF NOT EXISTS idx_events_errors_group_id 
  ON events_errors(error_group_id);

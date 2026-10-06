-- Error group canonical registry and lifecycle state
CREATE TABLE IF NOT EXISTS error_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id TEXT,
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  fingerprint VARCHAR(64) NOT NULL,
  fingerprint_version SMALLINT NOT NULL DEFAULT 2,
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  occurrence_count BIGINT NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_event_id VARCHAR(64) NOT NULL,
  latest_event_id VARCHAR(64) NOT NULL,
  latest_event_occurred_at TIMESTAMPTZ,
  highest_severity VARCHAR(16) NOT NULL,
  latest_severity VARCHAR(16) NOT NULL,
  is_regression BOOLEAN NOT NULL DEFAULT FALSE,
  regression_count INTEGER NOT NULL DEFAULT 0,
  last_regressed_at TIMESTAMPTZ,
  latest_release VARCHAR(100),
  latest_sdk_version VARCHAR(50),
  latest_application_version VARCHAR(50),
  latest_environment VARCHAR(64),
  latest_service VARCHAR(100),
  resolved_at TIMESTAMPTZ,
  resolved_release VARCHAR(100),
  last_error_message TEXT,
  last_error_name VARCHAR(255),
  last_status_code INTEGER,
  last_trace_id VARCHAR(64),
  last_request_id VARCHAR(64),
  merged_into UUID NULL,
  is_merged BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_error_groups_project_fingerprint UNIQUE (project_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_error_groups_pubid
  ON error_groups (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_error_groups_org_project_status_seen_v2
  ON error_groups (organization_id, project_id, status, last_seen_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_error_groups_project_fingerprint_v2
  ON error_groups (project_id, fingerprint);

CREATE INDEX IF NOT EXISTS idx_error_groups_project_status_last_seen
  ON error_groups (project_id, status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_groups_project_occurrence
  ON error_groups (project_id, occurrence_count DESC);

CREATE INDEX IF NOT EXISTS idx_error_groups_merged_into_v2
  ON error_groups (project_id, merged_into)
  WHERE merged_into IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_error_groups_resolved_release_v2
  ON error_groups (project_id, resolved_release, resolved_at)
  WHERE status = 'RESOLVED';

CREATE INDEX IF NOT EXISTS idx_error_groups_search
  ON error_groups USING GIN (to_tsvector('english', COALESCE(last_error_name, '') || ' ' || COALESCE(last_error_message, '')));

BEGIN;

CREATE UNLOGGED TABLE IF NOT EXISTS usage_counter_staging (
  id BIGSERIAL PRIMARY KEY,
  project_id UUID NOT NULL,
  org_id UUID NOT NULL,
  counter_type VARCHAR(64) NOT NULL,
  increment_by BIGINT NOT NULL DEFAULT 1 CHECK (increment_by > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_staging_project
  ON usage_counter_staging(project_id, counter_type, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_staging_flush
  ON usage_counter_staging(created_at);

COMMIT;

BEGIN;

CREATE TABLE IF NOT EXISTS ingestion_admin_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  log_level VARCHAR(16) NOT NULL CHECK (log_level IN ('debug', 'info', 'warn', 'error', 'fatal')),
  category VARCHAR(64) NOT NULL,
  message TEXT NOT NULL,
  org_id UUID,
  project_id UUID,
  job_id UUID,
  event_id VARCHAR(64),
  worker_id VARCHAR(128),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS ingestion_admin_logs_default
  PARTITION OF ingestion_admin_logs DEFAULT;

CREATE INDEX IF NOT EXISTS idx_admin_logs_created
  ON ingestion_admin_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_category
  ON ingestion_admin_logs(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_project
  ON ingestion_admin_logs(project_id, created_at DESC)
  WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admin_logs_level
  ON ingestion_admin_logs(log_level, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_metadata
  ON ingestion_admin_logs USING GIN (metadata);

COMMIT;

BEGIN;

CREATE TABLE IF NOT EXISTS retention_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID,
  project_id UUID,
  table_name TEXT NOT NULL,
  partition_name TEXT,
  cutoff_at TIMESTAMPTZ NOT NULL,
  state logdb_job_state NOT NULL DEFAULT 'pending',
  rows_deleted BIGINT NOT NULL DEFAULT 0,
  bytes_reclaimed BIGINT NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE TABLE IF NOT EXISTS retention_jobs_default PARTITION OF retention_jobs DEFAULT;
CREATE INDEX IF NOT EXISTS idx_retention_jobs_claim ON retention_jobs(state, cutoff_at, created_at) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS idx_retention_jobs_table_time ON retention_jobs(table_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_retention_jobs_brin ON retention_jobs USING BRIN (created_at);
DROP TRIGGER IF EXISTS trg_retention_jobs_updated_at ON retention_jobs;
CREATE TRIGGER trg_retention_jobs_updated_at BEFORE UPDATE ON retention_jobs FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

CREATE TABLE IF NOT EXISTS retention_statistics (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID,
  project_id UUID,
  table_name TEXT NOT NULL,
  bucket DATE NOT NULL,
  rows_pruned BIGINT NOT NULL DEFAULT 0,
  bytes_pruned BIGINT NOT NULL DEFAULT 0,
  oldest_remaining_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, bucket)
) PARTITION BY RANGE (bucket);
CREATE TABLE IF NOT EXISTS retention_statistics_default PARTITION OF retention_statistics DEFAULT;
CREATE INDEX IF NOT EXISTS idx_retention_statistics_table_bucket ON retention_statistics(table_name, bucket DESC);

COMMIT;

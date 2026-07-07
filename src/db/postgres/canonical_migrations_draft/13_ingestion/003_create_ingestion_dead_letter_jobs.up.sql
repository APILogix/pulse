BEGIN;

CREATE TABLE IF NOT EXISTS ingestion_dead_letter_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_job_id UUID,
  queue VARCHAR(64) NOT NULL,
  job_type VARCHAR(64) NOT NULL,
  org_id UUID,
  project_id UUID,
  payload JSONB NOT NULL,
  dedupe_key VARCHAR(256),
  attempts SMALLINT NOT NULL,
  max_attempts SMALLINT NOT NULL DEFAULT 3,
  last_error TEXT NOT NULL,
  error_code VARCHAR(64),
  failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  replayed_at TIMESTAMPTZ,
  replayed_by VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dlq_queue_time
  ON ingestion_dead_letter_jobs(queue, failed_at);
CREATE INDEX IF NOT EXISTS idx_dlq_project
  ON ingestion_dead_letter_jobs(project_id, failed_at)
  WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dlq_unreplayed
  ON ingestion_dead_letter_jobs(failed_at)
  WHERE replayed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dlq_original_job
  ON ingestion_dead_letter_jobs(original_job_id)
  WHERE original_job_id IS NOT NULL;

COMMIT;

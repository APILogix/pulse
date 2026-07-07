BEGIN;

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue VARCHAR(64) NOT NULL DEFAULT 'ingestion',
  job_type VARCHAR(64) NOT NULL CHECK (job_type IN (
    'error', 'message', 'request', 'span', 'trace',
    'metric', 'log', 'profile', 'cron_checkin', 'replay'
  )),
  priority SMALLINT NOT NULL DEFAULT 100 CHECK (priority >= 0 AND priority <= 1000),
  priority_label ingestion_job_priority GENERATED ALWAYS AS (
    CASE
      WHEN priority <= 10 THEN 'critical'::ingestion_job_priority
      WHEN priority <= 50 THEN 'high'::ingestion_job_priority
      WHEN priority <= 80 THEN 'normal'::ingestion_job_priority
      WHEN priority <= 95 THEN 'low'::ingestion_job_priority
      ELSE 'background'::ingestion_job_priority
    END
  ) STORED,
  org_id UUID,
  project_id UUID,
  payload JSONB NOT NULL,
  event_id VARCHAR(64),
  trace_id VARCHAR(64),
  span_id VARCHAR(64),
  session_id VARCHAR(64),
  user_id VARCHAR(64),
  tenant_id VARCHAR(64),
  dedupe_key VARCHAR(256),
  state ingestion_job_state NOT NULL DEFAULT 'pending',
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 50),
  max_attempts SMALLINT NOT NULL DEFAULT 3 CHECK (max_attempts >= 1 AND max_attempts <= 50),
  locked_until TIMESTAMPTZ,
  locked_by VARCHAR(128),
  heartbeat_at TIMESTAMPTZ,
  last_error TEXT,
  error_code VARCHAR(64),
  processed_by VARCHAR(128),
  processing_duration_ms INTEGER CHECK (processing_duration_ms IS NULL OR processing_duration_ms >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_claim
  ON ingestion_jobs(queue, priority ASC, run_at ASC, created_at ASC)
  WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_claim_typed
  ON ingestion_jobs(queue, job_type, priority ASC, run_at ASC)
  WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_lease
  ON ingestion_jobs(locked_until, state)
  WHERE state = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingestion_jobs_dedupe
  ON ingestion_jobs(dedupe_key)
  WHERE dedupe_key IS NOT NULL AND state IN ('pending', 'active');
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_project
  ON ingestion_jobs(project_id, state, priority)
  WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_org_state
  ON ingestion_jobs(org_id, state)
  WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_event_id
  ON ingestion_jobs(event_id)
  WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_trace_id
  ON ingestion_jobs(trace_id)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_completed
  ON ingestion_jobs(completed_at)
  WHERE state = 'completed';

DROP TRIGGER IF EXISTS trg_ingestion_jobs_updated_at ON ingestion_jobs;
CREATE TRIGGER trg_ingestion_jobs_updated_at
  BEFORE UPDATE ON ingestion_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

BEGIN;

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID,
  project_id UUID,
  environment_id UUID,
  api_key_id UUID,
  queue TEXT NOT NULL DEFAULT 'ingestion',
  job_type TEXT NOT NULL,
  priority SMALLINT NOT NULL DEFAULT 100 CHECK (priority BETWEEN 0 AND 1000),
  state logdb_job_state NOT NULL DEFAULT 'pending',
  dedupe_key TEXT,
  payload JSONB NOT NULL,
  error_code TEXT,
  last_error TEXT,
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts SMALLINT NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_by TEXT,
  locked_until TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE TABLE IF NOT EXISTS ingestion_jobs_default PARTITION OF ingestion_jobs DEFAULT;
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_claim ON ingestion_jobs(queue, priority, run_at, created_at) WHERE state = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingestion_jobs_dedupe ON ingestion_jobs(dedupe_key, created_at) WHERE dedupe_key IS NOT NULL AND state IN ('pending', 'active');
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_payload_gin ON ingestion_jobs USING GIN (payload);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_created_brin ON ingestion_jobs USING BRIN (created_at);
DROP TRIGGER IF EXISTS trg_ingestion_jobs_updated_at ON ingestion_jobs;
CREATE TRIGGER trg_ingestion_jobs_updated_at BEFORE UPDATE ON ingestion_jobs FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();

CREATE TABLE IF NOT EXISTS ingestion_dead_letter_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  original_job_id UUID,
  organization_id UUID,
  project_id UUID,
  environment_id UUID,
  job_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  failure_reason TEXT NOT NULL,
  error_code TEXT,
  attempts SMALLINT NOT NULL DEFAULT 0,
  replayed_at TIMESTAMPTZ,
  discarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE TABLE IF NOT EXISTS ingestion_dead_letter_jobs_default PARTITION OF ingestion_dead_letter_jobs DEFAULT;
CREATE INDEX IF NOT EXISTS idx_ingestion_dead_letter_org_time ON ingestion_dead_letter_jobs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_dead_letter_payload_gin ON ingestion_dead_letter_jobs USING GIN (payload);
CREATE INDEX IF NOT EXISTS idx_ingestion_dead_letter_created_brin ON ingestion_dead_letter_jobs USING BRIN (created_at);

CREATE TABLE IF NOT EXISTS ingestion_admin_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID,
  project_id UUID,
  actor_user_id UUID,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE TABLE IF NOT EXISTS ingestion_admin_logs_default PARTITION OF ingestion_admin_logs DEFAULT;
CREATE INDEX IF NOT EXISTS idx_ingestion_admin_logs_org_time ON ingestion_admin_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_admin_logs_metadata_gin ON ingestion_admin_logs USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_ingestion_admin_logs_created_brin ON ingestion_admin_logs USING BRIN (created_at);

CREATE TABLE IF NOT EXISTS usage_counter_staging (
  organization_id UUID NOT NULL,
  project_id UUID,
  environment_id UUID,
  api_key_id UUID,
  bucket TIMESTAMPTZ NOT NULL,
  event_type TEXT NOT NULL,
  count_delta BIGINT NOT NULL DEFAULT 0,
  bytes_delta BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, project_id, environment_id, api_key_id, bucket, event_type)
);
CREATE INDEX IF NOT EXISTS idx_usage_counter_staging_bucket ON usage_counter_staging(bucket);

CREATE TABLE IF NOT EXISTS ingestion_queue_snapshot (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  queue TEXT NOT NULL,
  pending_count BIGINT NOT NULL DEFAULT 0,
  active_count BIGINT NOT NULL DEFAULT 0,
  failed_count BIGINT NOT NULL DEFAULT 0,
  oldest_pending_at TIMESTAMPTZ,
  worker_count INTEGER NOT NULL DEFAULT 0,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);
CREATE TABLE IF NOT EXISTS ingestion_queue_snapshot_default PARTITION OF ingestion_queue_snapshot DEFAULT;
CREATE INDEX IF NOT EXISTS idx_ingestion_queue_snapshot_queue_time ON ingestion_queue_snapshot(queue, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_queue_snapshot_brin ON ingestion_queue_snapshot USING BRIN (captured_at);

CREATE TABLE IF NOT EXISTS ingestion_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID,
  project_id UUID,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC(18,6) NOT NULL,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);
CREATE TABLE IF NOT EXISTS ingestion_metrics_default PARTITION OF ingestion_metrics DEFAULT;
CREATE INDEX IF NOT EXISTS idx_ingestion_metrics_name_time ON ingestion_metrics(metric_name, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_metrics_dimensions_gin ON ingestion_metrics USING GIN (dimensions);
CREATE INDEX IF NOT EXISTS idx_ingestion_metrics_brin ON ingestion_metrics USING BRIN (captured_at);

CREATE TABLE IF NOT EXISTS worker_performance (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  worker_id TEXT NOT NULL,
  queue TEXT NOT NULL,
  processed_count BIGINT NOT NULL DEFAULT 0,
  failed_count BIGINT NOT NULL DEFAULT 0,
  avg_duration_ms NUMERIC(12,3),
  p95_duration_ms NUMERIC(12,3),
  memory_mb NUMERIC(12,3),
  cpu_percent NUMERIC(6,3),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);
CREATE TABLE IF NOT EXISTS worker_performance_default PARTITION OF worker_performance DEFAULT;
CREATE INDEX IF NOT EXISTS idx_worker_performance_worker_time ON worker_performance(worker_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_performance_brin ON worker_performance USING BRIN (captured_at);

CREATE TABLE IF NOT EXISTS ingestion_hourly_summary (
  organization_id UUID NOT NULL,
  project_id UUID,
  bucket TIMESTAMPTZ NOT NULL,
  accepted_events BIGINT NOT NULL DEFAULT 0,
  rejected_events BIGINT NOT NULL DEFAULT 0,
  bytes_ingested BIGINT NOT NULL DEFAULT 0,
  failures BIGINT NOT NULL DEFAULT 0,
  p95_ingest_latency_ms NUMERIC(12,3),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, project_id, bucket)
) PARTITION BY RANGE (bucket);
CREATE TABLE IF NOT EXISTS ingestion_hourly_summary_default PARTITION OF ingestion_hourly_summary DEFAULT;
CREATE INDEX IF NOT EXISTS idx_ingestion_hourly_summary_brin ON ingestion_hourly_summary USING BRIN (bucket);

CREATE TABLE IF NOT EXISTS backpressure_gauge (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  queue TEXT NOT NULL,
  pressure_score NUMERIC(8,4) NOT NULL CHECK (pressure_score >= 0),
  reason TEXT,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);
CREATE TABLE IF NOT EXISTS backpressure_gauge_default PARTITION OF backpressure_gauge DEFAULT;
CREATE INDEX IF NOT EXISTS idx_backpressure_queue_time ON backpressure_gauge(queue, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_backpressure_brin ON backpressure_gauge USING BRIN (captured_at);

CREATE TABLE IF NOT EXISTS ingestion_failures (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID,
  project_id UUID,
  environment_id UUID,
  api_key_id UUID,
  event_type TEXT,
  error_code TEXT NOT NULL,
  error_message TEXT,
  payload JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
CREATE TABLE IF NOT EXISTS ingestion_failures_default PARTITION OF ingestion_failures DEFAULT;
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_org_time ON ingestion_failures(organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_error_time ON ingestion_failures(error_code, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_payload_gin ON ingestion_failures USING GIN (payload);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_brin ON ingestion_failures USING BRIN (occurred_at);

COMMIT;

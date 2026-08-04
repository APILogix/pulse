BEGIN;

-- The dedicated Log DB stores telemetry and derived operational facts only.
-- pg-boss jobs, ingestion_dead_letter_jobs, usage_counter_staging, billing
-- rollups, and their administration remain authoritative in the control-plane
-- database and are intentionally not duplicated here.

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
  environment TEXT NOT NULL,
  api_key_id UUID,
  event_type TEXT,
  error_code TEXT NOT NULL,
  error_message TEXT,
  payload JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT ingestion_failures_environment_string_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (occurred_at);
CREATE TABLE IF NOT EXISTS ingestion_failures_default PARTITION OF ingestion_failures DEFAULT;
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_tenant_env_time
  ON ingestion_failures(organization_id,project_id,environment,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_error_time ON ingestion_failures(error_code, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_payload_gin ON ingestion_failures USING GIN (payload);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_brin ON ingestion_failures USING BRIN (occurred_at);

COMMIT;

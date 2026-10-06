-- Ingestion rejection and parsing error DLQ (range-partitioned by occurred_at)
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
  ON ingestion_failures(organization_id, project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_error_time ON ingestion_failures(error_code, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_payload_gin ON ingestion_failures USING GIN (payload);
CREATE INDEX IF NOT EXISTS idx_ingestion_failures_brin ON ingestion_failures USING BRIN (occurred_at);

BEGIN;

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(32) NOT NULL,
  external_event_id VARCHAR(128) NOT NULL,
  event_type VARCHAR(128) NOT NULL,
  payload JSONB NOT NULL,
  signature_header TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  processing_status VARCHAR(24) NOT NULL DEFAULT 'pending',
  processing_error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, external_event_id)
);

DROP TRIGGER IF EXISTS trg_billing_webhook_events_updated_at ON billing_webhook_events;
CREATE TRIGGER trg_billing_webhook_events_updated_at
BEFORE UPDATE ON billing_webhook_events
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_billing_webhook_status_received
ON billing_webhook_events(processing_status, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_webhook_org_received
ON billing_webhook_events(org_id, received_at DESC)
WHERE org_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS billing_job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name VARCHAR(64) NOT NULL,
  run_key VARCHAR(128),
  status VARCHAR(24) NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  duration_ms BIGINT CHECK (duration_ms IS NULL OR duration_ms >= 0),
  processed_count INTEGER NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
  succeeded_count INTEGER NOT NULL DEFAULT 0 CHECK (succeeded_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_billing_job_runs_updated_at ON billing_job_runs;
CREATE TRIGGER trg_billing_job_runs_updated_at
BEFORE UPDATE ON billing_job_runs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_billing_job_runs_name_started
ON billing_job_runs(job_name, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_job_runs_status_started
ON billing_job_runs(status, started_at DESC);

COMMIT;

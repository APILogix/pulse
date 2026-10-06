-- Normalized final definition for alert_dead_letter_events.
-- Canonical/historical sources include:
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS alert_dead_letter_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_queue VARCHAR(100) NOT NULL,
  pg_boss_job_id VARCHAR(255),
  batch_id UUID,
  event_ids UUID[] NOT NULL DEFAULT '{}',
  job_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  status alert_dead_letter_status NOT NULL DEFAULT 'pending_retry',
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  last_retry_at TIMESTAMPTZ,
  retried_at TIMESTAMPTZ,
  discarded_at TIMESTAMPTZ,
  discarded_by UUID REFERENCES users(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_dead_letter_org_status
  ON alert_dead_letter_events(organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_dead_letter_retryable
  ON alert_dead_letter_events(status, created_at)
  WHERE status = 'pending_retry';

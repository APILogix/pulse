-- =============================================================================
-- Module      : Automation
-- Migration   : 007_automation_runs.sql
-- Description : Execution instances for workflow versions
-- Author      : Pulse Platform
-- PostgreSQL  : 16+
-- Idempotent  : Yes
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL,
  workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  workflow_version_id UUID NOT NULL REFERENCES automation_workflow_versions(id) ON DELETE RESTRICT,
  trigger_id UUID NULL,  -- FK added in 014 after events_inbox exists
  inbox_event_id UUID NULL,  -- FK added in 012 after events_inbox exists
  status automation_run_status NOT NULL DEFAULT 'queued',
  trigger_type VARCHAR(120) NOT NULL,
  source_module VARCHAR(80) NOT NULL,
  source_event_id VARCHAR(200),
  dedupe_key VARCHAR(300),
  idempotency_key VARCHAR(300) NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  attempt INTEGER NOT NULL DEFAULT 1,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code VARCHAR(120),
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_automation_runs_idempotency UNIQUE (idempotency_key),
  CONSTRAINT chk_runs_attempt_positive CHECK (attempt > 0),
  CONSTRAINT chk_runs_max_attempts_positive CHECK (max_attempts > 0)
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_org_created
  ON automation_runs(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_runs_workflow_created
  ON automation_runs(workflow_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_runs_status_priority
  ON automation_runs(status, priority DESC, queued_at);

CREATE INDEX IF NOT EXISTS idx_automation_runs_status_expires
  ON automation_runs(status, expires_at);

CREATE INDEX IF NOT EXISTS idx_automation_runs_inbox_event
  ON automation_runs(inbox_event_id);

CREATE INDEX IF NOT EXISTS idx_automation_runs_dedupe
  ON automation_runs(dedupe_key);

-- BRIN on created_at for range scans on append-heavy table
CREATE INDEX IF NOT EXISTS idx_automation_runs_created_brin
  ON automation_runs USING BRIN (created_at);

CREATE INDEX IF NOT EXISTS idx_automation_runs_input_payload
  ON automation_runs USING GIN (input_payload);

-- Updated-at trigger
DROP TRIGGER IF EXISTS trg_automation_runs_updated_at ON automation_runs;
CREATE TRIGGER trg_automation_runs_updated_at
  BEFORE UPDATE ON automation_runs
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMIT;

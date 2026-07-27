-- =============================================================================
-- Module      : Automation
-- Migration   : 012_automation_events_inbox.sql
-- Description : Idempotent automation trigger event inbox
-- Author      : Pulse Platform
-- PostgreSQL  : 16+
-- Idempotent  : Yes
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS automation_events_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL,
  source_module VARCHAR(80) NOT NULL,
  event_type VARCHAR(120) NOT NULL,
  source_event_id VARCHAR(200),
  dedupe_key VARCHAR(300) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(40) NOT NULL DEFAULT 'pending',
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by VARCHAR(100),
  processed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  last_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT chk_events_inbox_attempts_nonneg CHECK (attempts >= 0),
  CONSTRAINT chk_events_inbox_status CHECK (status IN ('pending','processing','processed','retry','failed'))
);

-- Tenant-aware deduplication. PostgreSQL 16 NULLS NOT DISTINCT gives system
-- events (organization_id IS NULL) the same deterministic dedupe semantics
-- without making a customer-provided key collide across organizations.
ALTER TABLE automation_events_inbox
  DROP CONSTRAINT IF EXISTS uq_events_inbox_dedupe;
ALTER TABLE automation_events_inbox
  ADD CONSTRAINT uq_events_inbox_dedupe
  UNIQUE NULLS NOT DISTINCT (organization_id, dedupe_key);

CREATE INDEX IF NOT EXISTS idx_automation_inbox_status_retry
  ON automation_events_inbox(status, next_retry_at, received_at);

CREATE INDEX IF NOT EXISTS idx_automation_inbox_org_received
  ON automation_events_inbox(organization_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_inbox_source
  ON automation_events_inbox(source_module, event_type, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_inbox_payload
  ON automation_events_inbox USING GIN (payload);

-- Add deferred FK from automation_runs to events_inbox and triggers
ALTER TABLE automation_runs
  DROP CONSTRAINT IF EXISTS fk_runs_inbox_event;
ALTER TABLE automation_runs
  ADD CONSTRAINT fk_runs_inbox_event
  FOREIGN KEY (inbox_event_id) REFERENCES automation_events_inbox(id) ON DELETE SET NULL;

ALTER TABLE automation_runs
  DROP CONSTRAINT IF EXISTS fk_runs_trigger;
ALTER TABLE automation_runs
  ADD CONSTRAINT fk_runs_trigger
  FOREIGN KEY (trigger_id) REFERENCES automation_triggers(id) ON DELETE SET NULL;

COMMIT;

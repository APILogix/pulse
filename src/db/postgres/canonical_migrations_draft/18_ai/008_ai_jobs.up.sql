-- =============================================================================
-- Module      : AI Reliability Assistant
-- Migration   : 008_ai_jobs.up.sql
-- Description : Async AI job metadata (weekly reports, large incident
--               summaries) backed by pg-boss.
-- PostgreSQL  : 16+
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS ai_jobs (
  job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ai_mode TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  input_hash TEXT,
  pgboss_job_id TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ai_jobs IS
  'Async AI job tracking (pg-boss backed) for weekly reports and large incident summaries.';

CREATE INDEX IF NOT EXISTS idx_ai_jobs_tenant_status
  ON ai_jobs (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_tenant_time
  ON ai_jobs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_pgboss
  ON ai_jobs (pgboss_job_id)
  WHERE pgboss_job_id IS NOT NULL;

COMMIT;

-- =============================================================================
-- Module      : Automation
-- Migration   : 002_automation_workflows.sql
-- Description : Core automation_workflows table
-- Author      : Pulse Platform
-- PostgreSQL  : 16+
-- Idempotent  : Yes
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS automation_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  template_id UUID NULL,  -- FK added in 010 after templates table exists
  name VARCHAR(150) NOT NULL,
  slug VARCHAR(150) NOT NULL,
  description TEXT,
  workflow_type VARCHAR(80) NOT NULL,
  scope automation_workflow_scope NOT NULL DEFAULT 'organization',
  status automation_workflow_status NOT NULL DEFAULT 'draft',
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  current_version INTEGER NOT NULL DEFAULT 1,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  timezone VARCHAR(80) NOT NULL DEFAULT 'UTC',
  tags TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  -- Organization workflows require organization_id
  CONSTRAINT chk_workflows_org_scope CHECK (
    (scope = 'organization' AND organization_id IS NOT NULL) OR
    (scope = 'project' AND project_id IS NOT NULL AND organization_id IS NOT NULL) OR
    (scope = 'platform' AND organization_id IS NULL)
  ),
  CONSTRAINT chk_workflows_current_version CHECK (current_version > 0)
);

-- Unique active slug per org/project/scope
CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_workflows_org_slug
  ON automation_workflows(organization_id, slug)
  WHERE deleted_at IS NULL AND scope = 'organization';

CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_workflows_project_slug
  ON automation_workflows(project_id, slug)
  WHERE deleted_at IS NULL AND scope = 'project';

CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_workflows_platform_slug
  ON automation_workflows(slug)
  WHERE deleted_at IS NULL AND scope = 'platform';

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_automation_workflows_org_status
  ON automation_workflows(organization_id, status, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_workflows_org_enabled_next_run
  ON automation_workflows(organization_id, is_enabled, next_run_at)
  WHERE deleted_at IS NULL AND is_enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_automation_workflows_project_status
  ON automation_workflows(project_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_workflows_type_status
  ON automation_workflows(workflow_type, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_workflows_tags
  ON automation_workflows USING GIN (tags)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_workflows_metadata
  ON automation_workflows USING GIN (metadata);

-- Updated-at trigger
DROP TRIGGER IF EXISTS trg_automation_workflows_updated_at ON automation_workflows;
CREATE TRIGGER trg_automation_workflows_updated_at
  BEFORE UPDATE ON automation_workflows
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMIT;

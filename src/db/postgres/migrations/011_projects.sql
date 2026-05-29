-- ============================================================================
-- 011_projects.sql
-- ----------------------------------------------------------------------------
-- Canonical, idempotent schema for the PROJECT MODULE.
--
-- Why this file exists:
--   The project DDL previously lived in src/db/postgres/schema3.sql, OUTSIDE
--   the migrations directory, so it was never applied by setup-db.ts. This
--   migration brings projects + project_api_keys under migration control.
--
-- Depends on: 010_organizations.sql (projects FK organizations).
--
-- Safe to run repeatedly. No destructive statements.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1) ENUMS (idempotent)
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE project_status AS ENUM ('active','paused','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- NOTE: the application (projects/types.ts ProjectEnvironmentSchema) only uses
-- 'development' and 'production'. 'staging' is included for forward
-- compatibility; the app simply never emits it today.
DO $$ BEGIN
  CREATE TYPE project_environment AS ENUM ('development','staging','production');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Shared trigger fn (also created in 010; CREATE OR REPLACE keeps it idempotent).
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 2) PROJECTS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    description TEXT,
    status project_status NOT NULL DEFAULT 'active',
    environment project_environment NOT NULL DEFAULT 'development',
    production_api_prefix VARCHAR(20),
    development_api_prefix VARCHAR(20),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(org_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_projects_org
  ON projects(org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_projects_active
  ON projects(org_id, status) WHERE deleted_at IS NULL;
-- Stable keyset pagination (created_at, id).
CREATE INDEX IF NOT EXISTS idx_projects_cursor
  ON projects(org_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- 3) PROJECT API KEYS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    environment project_environment NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,        -- SHA-256 hex of the full key; raw key never stored
    key_prefix VARCHAR(32) NOT NULL,      -- public identifier for candidate lookup
    name VARCHAR(255),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    revoked_at TIMESTAMPTZ,
    revoked_reason TEXT,
    rotated_from_key_id UUID REFERENCES project_api_keys(id),
    last_used_at TIMESTAMPTZ,
    last_used_ip INET,
    usage_count BIGINT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary ingestion auth lookup: narrow active keys by prefix, then the service
-- does a constant-time hash compare against the candidate set.
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix_active
  ON project_api_keys(key_prefix) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_api_keys_project
  ON project_api_keys(project_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_project_active
  ON project_api_keys(project_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_api_keys_expiry
  ON project_api_keys(expires_at) WHERE expires_at IS NOT NULL AND is_active = TRUE;

COMMIT;

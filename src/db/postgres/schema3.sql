-- =====================================================
-- EXTENSIONS
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================
-- ENUMS
-- =====================================================

DO $$ BEGIN
    CREATE TYPE project_status AS ENUM (
        'active',
        'paused',
        'archived'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE project_environment AS ENUM (
        'development',
        'staging',
        'production'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- =====================================================
-- UPDATED_AT TRIGGER FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- PROJECTS
-- =====================================================

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    org_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    name VARCHAR(255) NOT NULL,

    slug VARCHAR(255) NOT NULL
        CHECK (
            slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
        ),

    description TEXT,

    status project_status NOT NULL DEFAULT 'active',

    environment project_environment
        NOT NULL DEFAULT 'development',

    production_api_prefix VARCHAR(20),
    development_api_prefix VARCHAR(20),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    archived_at TIMESTAMPTZ,

    deleted_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(org_id, slug)
);

-- Fast org project fetches
CREATE INDEX idx_projects_org
ON projects(org_id)
WHERE deleted_at IS NULL;

-- Active projects
CREATE INDEX idx_projects_active
ON projects(org_id, status)
WHERE deleted_at IS NULL;

CREATE TRIGGER trg_projects_updated_at
BEFORE UPDATE ON projects
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- =====================================================
-- PROJECT API KEYS
-- =====================================================

CREATE TABLE IF NOT EXISTS project_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    project_id UUID NOT NULL
        REFERENCES projects(id)
        ON DELETE CASCADE,

    environment project_environment NOT NULL,

    -- NEVER store raw key
    key_hash TEXT NOT NULL UNIQUE,

    -- visible identifier
    key_prefix VARCHAR(32) NOT NULL,

    name VARCHAR(255),

    created_by UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    revoked_at TIMESTAMPTZ,

    revoked_reason TEXT,

    rotated_from_key_id UUID
        REFERENCES project_api_keys(id),

    last_used_at TIMESTAMPTZ,

    last_used_ip INET,

    usage_count BIGINT NOT NULL DEFAULT 0,

    expires_at TIMESTAMPTZ,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- INDEXES
-- =====================================================

-- Main auth lookup path
CREATE INDEX idx_api_keys_auth_lookup
ON project_api_keys(key_hash, environment)
WHERE is_active = TRUE;

-- Project key listing
CREATE INDEX idx_api_keys_project
ON project_api_keys(project_id);

-- Last used analytics
CREATE INDEX idx_api_keys_last_used
ON project_api_keys(last_used_at DESC);

-- Active keys per project
CREATE INDEX idx_api_keys_project_active
ON project_api_keys(project_id)
WHERE is_active = TRUE;
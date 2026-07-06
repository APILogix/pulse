CREATE TYPE project_status AS ENUM ('active', 'archived', 'suspended');
CREATE TYPE project_environment AS ENUM ('development', 'production');
CREATE TYPE api_key_status AS ENUM ('active', 'revoked', 'expired');

CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(150) NOT NULL,
    description TEXT,
    status project_status NOT NULL DEFAULT 'active',
    default_environment project_environment NOT NULL DEFAULT 'production',
    icon VARCHAR(255),
    color VARCHAR(20),
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(org_id, slug)
);

CREATE INDEX idx_projects_org ON projects(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_status ON projects(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_cursor ON projects(org_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_archived ON projects(archived_at) WHERE archived_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_projects_org_status ON projects(org_id, status) WHERE deleted_at IS NULL;

CREATE TABLE project_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    environment project_environment NOT NULL,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix VARCHAR(20) NOT NULL,
    status api_key_status NOT NULL DEFAULT 'active',
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id),
    revoked_by UUID REFERENCES users(id),
    revoked_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_keys_project ON project_api_keys(project_id);
CREATE INDEX idx_api_keys_prefix ON project_api_keys(key_prefix);
CREATE INDEX idx_api_keys_status ON project_api_keys(status);
CREATE INDEX idx_api_keys_expiry ON project_api_keys(expires_at);
CREATE INDEX idx_api_keys_last_used ON project_api_keys(last_used_at);
CREATE INDEX idx_api_keys_project_env ON project_api_keys(project_id, environment) WHERE deleted_at IS NULL AND status = 'active';
CREATE INDEX idx_api_keys_revoked_cleanup ON project_api_keys(revoked_at, deleted_at) WHERE deleted_at IS NULL;

CREATE TABLE project_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES organization_roles(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id, user_id)
);

CREATE INDEX idx_project_members_project ON project_members(project_id);
CREATE INDEX idx_project_members_user ON project_members(user_id);
CREATE INDEX idx_project_members_role ON project_members(role_id);
CREATE INDEX idx_project_members_user_project ON project_members(user_id, project_id);

CREATE TABLE project_releases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    environment project_environment NOT NULL,
    version VARCHAR(100) NOT NULL,
    commit_sha VARCHAR(64),
    branch VARCHAR(150),
    released_by UUID REFERENCES users(id),
    released_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_project_releases_project ON project_releases(project_id);
CREATE INDEX idx_project_releases_environment ON project_releases(environment);
CREATE INDEX idx_project_releases_version ON project_releases(project_id, version);
CREATE INDEX idx_project_releases_time ON project_releases(project_id, released_at DESC);
CREATE INDEX idx_project_releases_project_env_time ON project_releases(project_id, environment, released_at DESC);
CREATE INDEX idx_project_releases_commit ON project_releases(commit_sha) WHERE commit_sha IS NOT NULL;
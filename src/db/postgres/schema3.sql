CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,

    -- core
    description TEXT,
    status VARCHAR(20) DEFAULT 'active', -- active, paused, archived

    -- environment
    environment VARCHAR(20) DEFAULT 'development', -- development, production

    -- api prefixes (simple for now)
    production_api_prefix VARCHAR(20),
    development_api_prefix VARCHAR(20),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(org_id, slug)
);
CREATE TABLE project_api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- security
    key_hash TEXT NOT NULL,          -- hashed full key
    key_prefix VARCHAR(16) NOT NULL, -- visible part (pk_live_abcd)

    -- environment
    environment VARCHAR(20) NOT NULL, -- development / production

    name VARCHAR(255),

    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES users(id),

    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (key_hash)  -- ensures no duplicate keys
);
-- Fast lookup during auth
CREATE INDEX idx_api_keys_hash 
ON project_api_keys(key_hash) 
WHERE is_active = TRUE;

-- Fetch keys per project
CREATE INDEX idx_api_keys_project 
ON project_api_keys(project_id);
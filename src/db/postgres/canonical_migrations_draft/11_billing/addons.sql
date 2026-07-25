CREATE TABLE addons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(50) NOT NULL UNIQUE,          -- 'session_replay', 'profiling'
    name VARCHAR(100) NOT NULL,
    description TEXT,
    category VARCHAR(20) NOT NULL             -- 'module', 'capacity', 'enterprise_feature'
        CHECK (category IN ('module','capacity','enterprise_feature')),
    
    -- What this add-on unlocks
    target_module VARCHAR(50),                -- 'sessionReplay', 'aiInsights', or NULL for capacity add-ons
    target_feature_id UUID REFERENCES billing_features(id),
    
    -- Availability rules
    available_in_tiers billing_plan_tier[] NOT NULL DEFAULT '{}',
    not_available_in_tiers billing_plan_tier[] NOT NULL DEFAULT '{enterprise}',
    
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}',
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

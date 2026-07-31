CREATE TYPE billing_feature_category AS ENUM
(
    'quota',
    'feature',

    'sdk',
    'transport',
    'sampling',
    'instrumentation',
    'privacy',
    'killswitch',

    'alerting',
    'integration',

    'ai',

    'dashboard',

    'security',

    'organization',

    'support'
);
ALTER TABLE plan_feature_entitlements
ADD COLUMN IF NOT EXISTS configuration JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN plan_feature_entitlements.configuration IS
'Optional structured configuration for advanced entitlements such as SDK runtime settings, sampling constraints, allowed values and unlimited mode.';
ALTER TABLE plan_feature_entitlements
ADD COLUMN IF NOT EXISTS display_value TEXT;

COMMENT ON COLUMN plan_feature_entitlements.display_value IS
'Human-readable value for pricing tables and billing UI (e.g. Unlimited, 100K/month).';
ALTER TYPE billing_feature_value_type
ADD VALUE IF NOT EXISTS 'json';
ALTER TABLE plans
ADD COLUMN IF NOT EXISTS is_customizable BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN plans.is_customizable IS
'Whether the plan supports custom negotiated entitlements and overrides.';
ALTER TABLE plans
ADD COLUMN IF NOT EXISTS next_plan_key VARCHAR(50);

COMMENT ON COLUMN plans.next_plan_key IS
'Suggested upgrade target plan.';
ALTER TABLE plans
ADD COLUMN IF NOT EXISTS previous_plan_key VARCHAR(50);

COMMENT ON COLUMN plans.previous_plan_key IS
'Suggested downgrade target plan.';
ALTER TABLE plans
ADD COLUMN IF NOT EXISTS badge VARCHAR(50);

COMMENT ON COLUMN plans.badge IS
'Optional marketing badge displayed on pricing pages.';

CREATE TABLE IF NOT EXISTS plan_feature_overrides
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    feature_id UUID NOT NULL
        REFERENCES billing_features(id)
        ON DELETE CASCADE,

    boolean_value BOOLEAN,
    integer_value BIGINT,
    decimal_value NUMERIC(20,6),
    string_value TEXT,

    configuration JSONB NOT NULL DEFAULT '{}'::jsonb,

    reason TEXT,

    expires_at TIMESTAMPTZ,

    created_by UUID REFERENCES users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    deleted_at TIMESTAMPTZ,

    CONSTRAINT uq_org_feature_override
        UNIQUE (organization_id, feature_id),

    CONSTRAINT chk_single_override_value CHECK
    (
        ((boolean_value IS NOT NULL)::int +
         (integer_value IS NOT NULL)::int +
         (decimal_value IS NOT NULL)::int +
         (string_value IS NOT NULL)::int) <= 1
    )
);

ALTER TABLE organization_subscriptions
ADD COLUMN next_plan_id UUID
REFERENCES plans(id);
ALTER TABLE organization_subscriptions
ADD COLUMN entitlement_version INTEGER
NOT NULL DEFAULT 1;
ALTER TABLE organization_subscriptions
ADD COLUMN entitlement_snapshot_version INTEGER;
CREATE TABLE IF NOT EXISTS organization_addons
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    feature_id UUID NOT NULL
        REFERENCES billing_features(id)
        ON DELETE CASCADE,

    quantity NUMERIC(20,6) NOT NULL,

    billing_interval billing_interval NOT NULL,

    starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    expires_at TIMESTAMPTZ,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_org_addons_org
ON organization_addons(organization_id);

CREATE INDEX idx_org_addons_feature
ON organization_addons(feature_id);

CREATE INDEX idx_org_addons_active
ON organization_addons(is_active);
CREATE TABLE IF NOT EXISTS feature_dependencies
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    feature_id UUID NOT NULL
        REFERENCES billing_features(id)
        ON DELETE CASCADE,

    depends_on_feature_id UUID NOT NULL
        REFERENCES billing_features(id)
        ON DELETE CASCADE,

    dependency_type VARCHAR(20) NOT NULL DEFAULT 'requires',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_feature_dependency_not_self
        CHECK (feature_id <> depends_on_feature_id),

    CONSTRAINT uq_feature_dependency
        UNIQUE (feature_id, depends_on_feature_id)
);

CREATE INDEX idx_feature_dependencies_feature
ON feature_dependencies(feature_id);

CREATE INDEX idx_feature_dependencies_depends_on
ON feature_dependencies(depends_on_feature_id);
CREATE TYPE billing_usage_behavior AS ENUM
(
    'none',

    'hard_limit',

    'soft_limit',

    'overage',

    'throttle'
);

ALTER TABLE billing_features
ADD COLUMN IF NOT EXISTS usage_behavior billing_usage_behavior
NOT NULL DEFAULT 'none';

COMMENT ON COLUMN billing_features.usage_behavior IS
'Defines how the platform behaves when the entitlement is exhausted.';

CREATE TYPE billing_usage_behavior AS ENUM
(
    'none',
    'hard_limit',
    'soft_limit',
    'overage',
    'throttle'
);

ALTER TABLE billing_features
ADD COLUMN IF NOT EXISTS usage_behavior billing_usage_behavior
NOT NULL DEFAULT 'none';

COMMENT ON COLUMN billing_features.usage_behavior IS
'Defines how the platform behaves when the entitlement is exhausted.';

ALTER TABLE plan_feature_entitlements
ADD CONSTRAINT chk_single_value
CHECK (
    ((boolean_value IS NOT NULL)::int +
     (integer_value IS NOT NULL)::int +
     (decimal_value IS NOT NULL)::int +
     (string_value IS NOT NULL)::int) <= 1
);

-- index 
CREATE INDEX idx_plans_active
ON plans(sort_order)
WHERE deleted_at IS NULL
AND is_active = TRUE;
CREATE INDEX idx_plan_prices_active
ON plan_prices(plan_id)
WHERE deleted_at IS NULL;
CREATE INDEX idx_feature_public
ON billing_features(category, sort_order)
WHERE is_public = TRUE;
CREATE INDEX idx_override_active
ON plan_feature_overrides(organization_id)
WHERE deleted_at IS NULL;

ALTER TABLE plans
ADD COLUMN version INTEGER
NOT NULL DEFAULT 1;
CREATE TYPE billing_visibility AS ENUM
(
    'public',
    'internal',
    'hidden'
);
ALTER TABLE billing_features
ADD COLUMN visibility billing_visibility
NOT NULL DEFAULT 'public';
CREATE TABLE organization_feature_usage
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    subscription_id UUID
        REFERENCES organization_subscriptions(id)
        ON DELETE CASCADE,

    feature_id UUID NOT NULL
        REFERENCES billing_features(id)
        ON DELETE CASCADE,

    period_start TIMESTAMPTZ NOT NULL,

    period_end TIMESTAMPTZ NOT NULL,

    used_value NUMERIC(20,6) NOT NULL DEFAULT 0,

    limit_value NUMERIC(20,6),

    overage_value NUMERIC(20,6) NOT NULL DEFAULT 0,

    last_used_at TIMESTAMPTZ,

    metadata JSONB NOT NULL DEFAULT '{}',

    created_at TIMESTAMPTZ DEFAULT NOW(),

    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE
    (
        organization_id,
        feature_id,
        period_start
    )
);
ALTER TABLE organization_subscriptions
ADD COLUMN auto_renew BOOLEAN
NOT NULL DEFAULT TRUE;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'billing_tax_behavior'
    ) THEN
        CREATE TYPE billing_tax_behavior AS ENUM
        (
            'exclusive',
            'inclusive',
            'unspecified'
        );
    END IF;
END
$$;
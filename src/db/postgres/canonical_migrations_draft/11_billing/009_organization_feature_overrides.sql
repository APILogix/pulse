-- =============================================================================
-- Module      : Billing
-- Migration   : 012_organization_feature_overrides.sql
-- Description : Organization-specific entitlement overrides
-- PostgreSQL  : 16+
-- Depends On  : 004_billing_features.sql
--               006_organization_subscriptions.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS organization_feature_overrides
(
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    organization_id UUID NOT NULL
        REFERENCES organizations(id)
        ON DELETE CASCADE,

    feature_id UUID NOT NULL
        REFERENCES billing_features(id)
        ON DELETE RESTRICT,

    boolean_value BOOLEAN,
    integer_value BIGINT,
    decimal_value NUMERIC(20,6),
    string_value TEXT,

    reason TEXT NOT NULL,

    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,

    created_by UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    approved_by UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    CONSTRAINT chk_override_window
        CHECK (expires_at IS NULL OR expires_at > effective_from),

    CONSTRAINT chk_override_single_value
        CHECK (
            ((boolean_value IS NOT NULL)::int +
             (integer_value IS NOT NULL)::int +
             (decimal_value IS NOT NULL)::int +
             (string_value IS NOT NULL)::int) <= 1
        )
);

COMMENT ON TABLE organization_feature_overrides IS
'Per-organization entitlement overrides. These take precedence over the base plan and are combined with subscription add-ons during entitlement resolution.';

CREATE INDEX IF NOT EXISTS idx_ofo_org
ON organization_feature_overrides(organization_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ofo_feature
ON organization_feature_overrides(feature_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ofo_org_feature
ON organization_feature_overrides(organization_id, feature_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ofo_active
ON organization_feature_overrides(effective_from, expires_at)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ofo_metadata
ON organization_feature_overrides
USING GIN(metadata);

DROP TRIGGER IF EXISTS trg_organization_feature_overrides_updated_at
ON organization_feature_overrides;

CREATE TRIGGER trg_organization_feature_overrides_updated_at
BEFORE UPDATE
ON organization_feature_overrides
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;

BEGIN;

DO $$ BEGIN
  CREATE TYPE coupon_discount_type AS ENUM ('percentage', 'fixed_amount');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE coupon_duration_type AS ENUM ('once', 'repeating', 'forever');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE quota_request_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  discount_type coupon_discount_type NOT NULL,
  discount_value NUMERIC(12,2) NOT NULL CHECK (discount_value > 0),
  currency VARCHAR(3) CHECK (currency IS NULL OR char_length(currency) = 3),
  duration coupon_duration_type NOT NULL,
  duration_in_months INTEGER CHECK (duration_in_months IS NULL OR duration_in_months > 0),
  max_redemptions INTEGER CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  redeem_by TIMESTAMPTZ,
  times_redeemed INTEGER NOT NULL DEFAULT 0 CHECK (times_redeemed >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (NOT (discount_type = 'percentage' AND discount_value > 100))
);

DROP TRIGGER IF EXISTS trg_coupons_updated_at ON coupons;
CREATE TRIGGER trg_coupons_updated_at
BEFORE UPDATE ON coupons
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_coupons_active
ON coupons(code)
WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_coupons_redeem_by
ON coupons(redeem_by);

CREATE TABLE IF NOT EXISTS quota_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  quota_type VARCHAR(50) NOT NULL,
  requested_limit BIGINT NOT NULL CHECK (requested_limit > current_limit),
  current_limit BIGINT NOT NULL CHECK (current_limit >= 0),
  reason TEXT NOT NULL,
  status quota_request_status NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (status = 'pending' AND reviewed_at IS NULL)
    OR (status IN ('approved', 'rejected'))
  )
);

DROP TRIGGER IF EXISTS trg_quota_requests_updated_at ON quota_requests;
CREATE TRIGGER trg_quota_requests_updated_at
BEFORE UPDATE ON quota_requests
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_quota_requests_org
ON quota_requests(org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quota_requests_status
ON quota_requests(status);

COMMIT;

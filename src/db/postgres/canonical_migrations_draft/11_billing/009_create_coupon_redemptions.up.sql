BEGIN;

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_coupon_redemptions_coupon_org UNIQUE (coupon_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_org
  ON coupon_redemptions(org_id, redeemed_at DESC);

COMMIT;

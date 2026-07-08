-- ============================================================
-- FIX 1: Webhook idempotency (build this before wiring Stripe/Razorpay)
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider billing_provider_type NOT NULL,
  provider_event_id VARCHAR(150) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  processing_status VARCHAR(20) NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'processing', 'processed', 'failed', 'ignored')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT uq_billing_webhook_provider_event UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_webhook_pending
  ON billing_webhook_events(received_at)
  WHERE processing_status IN ('received', 'failed');
CREATE INDEX IF NOT EXISTS idx_billing_webhook_org
  ON billing_webhook_events(org_id, received_at DESC)
  WHERE org_id IS NOT NULL;

COMMIT;

-- ============================================================
-- FIX 2: Tax fields — invoices + organizations
-- ============================================================
BEGIN;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS tax_amount INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS tax_id_snapshot VARCHAR(50),
  ADD COLUMN IF NOT EXISTS billing_address_snapshot JSONB;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS billing_address JSONB,
  ADD COLUMN IF NOT EXISTS tax_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS tax_id_type VARCHAR(20);

COMMIT;

-- ============================================================
-- FIX 3: Fast-path usage counter for ingest-time quota checks
-- (usage_daily_counters stays as the durable/reporting layer)
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS organization_usage_current_period (
  org_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES organization_subscriptions(id) ON DELETE SET NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  events_count BIGINT NOT NULL DEFAULT 0,
  event_limit BIGINT NOT NULL,
  overage_events BIGINT NOT NULL DEFAULT 0,
  last_incremented_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_usage_period_end
  ON organization_usage_current_period(period_end);

DROP TRIGGER IF EXISTS trg_org_usage_current_period_updated_at ON organization_usage_current_period;
CREATE TRIGGER trg_org_usage_current_period_updated_at
  BEFORE UPDATE ON organization_usage_current_period
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
-- Note: increment this row atomically (UPDATE ... SET events_count = events_count + 1)
-- from Redis/your ingest path on a rollover schedule; usage_daily_counters remains
-- the source of truth for historical reporting and reconciliation.

-- ============================================================
-- FIX 4: Drop the dead `seats` column (event-based billing has no seat model)
-- If you DO plan seat-gating later, tell me and I'll design it properly
-- instead of leaving a nullable orphan column.
-- ============================================================
BEGIN;

ALTER TABLE organization_subscriptions
  DROP COLUMN IF EXISTS seats;

COMMIT;

-- ============================================================
-- FIX 5: coupons.applicable_plans → real FK-enforced join table
-- ============================================================
BEGIN;

ALTER TABLE coupons
  DROP COLUMN IF EXISTS applicable_plans;

CREATE TABLE IF NOT EXISTS coupon_applicable_plans (
  coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  PRIMARY KEY (coupon_id, plan_id)
);

CREATE INDEX IF NOT EXISTS idx_coupon_applicable_plans_plan
  ON coupon_applicable_plans(plan_id);

COMMIT;

-- ============================================================
-- FIX 6: subscription_events.actor → enum, consistent with everything else
-- ============================================================
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_event_actor') THEN
    CREATE TYPE subscription_event_actor AS ENUM ('user', 'system', 'billing_provider', 'admin');
  END IF;
END $$;

ALTER TABLE subscription_events
  ALTER COLUMN actor TYPE subscription_event_actor
  USING actor::subscription_event_actor;

COMMIT;
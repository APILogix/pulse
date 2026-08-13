-- Normalized final definition for billing_audit_logs.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/019_billing_audit_logs.sql
-- - migrations/002_create_all_ordered.sql
-- - migrations/002_create_all.sql

CREATE TABLE IF NOT EXISTS billing_audit_logs
(
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
  REFERENCES organizations(id)
  ON DELETE CASCADE,
  subscription_id UUID
  REFERENCES organization_subscriptions(id)
  ON DELETE SET NULL,
  invoice_id UUID
  REFERENCES invoices(id)
  ON DELETE SET NULL,
  payment_id UUID
  REFERENCES payments(id)
  ON DELETE SET NULL,
  coupon_id UUID
  REFERENCES coupons(id)
  ON DELETE SET NULL,
  actor_type subscription_event_actor NOT NULL,
  actor_user_id UUID
  REFERENCES users(id)
  ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  request_id UUID,
  correlation_id UUID,
  trace_id UUID,
  ip_address INET,
  user_agent TEXT,
  previous_state JSONB,
  new_state JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at)
)
PARTITION BY RANGE (occurred_at);

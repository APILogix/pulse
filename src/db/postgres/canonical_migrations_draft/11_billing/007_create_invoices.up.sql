BEGIN;

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES organization_subscriptions(id) ON DELETE CASCADE,
  provider billing_provider_type NOT NULL,
  provider_invoice_id VARCHAR(100) NOT NULL,
  status billing_invoice_status NOT NULL,
  amount_due INTEGER NOT NULL,
  amount_paid INTEGER NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  overage_events BIGINT NOT NULL DEFAULT 0,
  overage_amount INTEGER NOT NULL DEFAULT 0,
  pdf_url TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_invoices_provider_invoice UNIQUE (provider, provider_invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_invoices_org
  ON invoices(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_subscription
  ON invoices(subscription_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status
  ON invoices(status, created_at DESC);

COMMIT;

-- Normalized final definition for invoice_line_items.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/11_billing/invoice_line_items.sql

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_type VARCHAR(30) NOT NULL            
  CHECK (line_type IN ('plan','addon','overage','discount','tax','credit')),
  description VARCHAR(255) NOT NULL,
  quantity BIGINT NOT NULL DEFAULT 1,
  unit_amount_minor BIGINT NOT NULL,
  amount_minor BIGINT NOT NULL,
  plan_id UUID REFERENCES plans(id),
  addon_id UUID REFERENCES addons(id),
  feature_key VARCHAR(100),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

BEGIN;

DO $$ BEGIN
  CREATE TYPE invoice_status AS ENUM ('draft', 'open', 'paid', 'uncollectible', 'void');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS organization_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_number VARCHAR(50) NOT NULL UNIQUE,
  status invoice_status NOT NULL DEFAULT 'draft',
  invoice_date TIMESTAMPTZ NOT NULL,
  due_date TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  subtotal NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  discount_code VARCHAR(50),
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  total NUMERIC(12,2) NOT NULL CHECK (total >= 0),
  amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  amount_due NUMERIC(12,2) GENERATED ALWAYS AS (GREATEST(total - amount_paid, 0)) STORED,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD' CHECK (char_length(currency) = 3),
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  payment_method payment_method_type,
  payment_intent_id VARCHAR(100),
  stripe_invoice_id VARCHAR(100),
  pdf_url TEXT,
  footer_note TEXT,
  memo TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (due_date >= invoice_date),
  CHECK (period_end >= period_start),
  CHECK (amount_paid <= total)
);

DROP TRIGGER IF EXISTS trg_organization_invoices_updated_at ON organization_invoices;
CREATE TRIGGER trg_organization_invoices_updated_at
BEFORE UPDATE ON organization_invoices
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_invoices_org
ON organization_invoices(org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_status
ON organization_invoices(status);

CREATE INDEX IF NOT EXISTS idx_invoices_due_date_open
ON organization_invoices(due_date)
WHERE status = 'open';

COMMIT;

BEGIN;

CREATE TABLE IF NOT EXISTS alerting_provider_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_key VARCHAR(50) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'not_configured'
    CHECK (status IN ('not_configured', 'available', 'disabled')),
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alerting_provider_catalog_org_key UNIQUE (organization_id, provider_key),
  CONSTRAINT ck_alerting_provider_capabilities CHECK (jsonb_typeof(capabilities) = 'object'),
  CONSTRAINT ck_alerting_provider_metadata CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_alerting_provider_catalog_org_status
  ON alerting_provider_catalog(organization_id, status, provider_key);

DROP TRIGGER IF EXISTS trg_alerting_provider_catalog_updated_at ON alerting_provider_catalog;
CREATE TRIGGER trg_alerting_provider_catalog_updated_at
  BEFORE UPDATE ON alerting_provider_catalog
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE alerting_provider_catalog IS
  'Organization-visible provider metadata. This table never stores connector credentials or instances.';

COMMIT;

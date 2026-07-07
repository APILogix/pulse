BEGIN;

CREATE TABLE IF NOT EXISTS organization_sso_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_name VARCHAR(100) NOT NULL,
  provider_type VARCHAR(50) NOT NULL,
  entity_id TEXT,
  sso_url TEXT,
  x509_certificate TEXT,
  domain VARCHAR(255),
  oidc_issuer TEXT,
  oidc_client_id TEXT,
  oidc_client_secret_encrypted TEXT,
  oidc_scopes TEXT,
  oidc_jit_provision BOOLEAN NOT NULL DEFAULT FALSE,
  oidc_jit_default_role VARCHAR(50) NOT NULL DEFAULT 'member',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sso_providers_org
  ON organization_sso_providers(org_id);
CREATE INDEX IF NOT EXISTS idx_sso_providers_active_domain_type
  ON organization_sso_providers(provider_type, LOWER(domain))
  WHERE is_active = TRUE AND domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sso_providers_active_entity_id
  ON organization_sso_providers(entity_id)
  WHERE is_active = TRUE AND provider_type = 'saml' AND entity_id IS NOT NULL;

COMMIT;

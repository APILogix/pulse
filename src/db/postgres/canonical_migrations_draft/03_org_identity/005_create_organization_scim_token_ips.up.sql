BEGIN;

CREATE TABLE IF NOT EXISTS organization_scim_token_ips (
  token_id UUID NOT NULL REFERENCES organization_scim_tokens(id) ON DELETE CASCADE,
  ip_cidr CIDR NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (token_id, ip_cidr)
);

CREATE INDEX IF NOT EXISTS idx_scim_token_ips_token
  ON organization_scim_token_ips(token_id);

COMMIT;

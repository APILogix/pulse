BEGIN;

CREATE TABLE IF NOT EXISTS connector_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE,
  secret_type VARCHAR(50) NOT NULL,
  encrypted_value BYTEA NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_secret_type_per_connector UNIQUE (connector_id, secret_type)
);

CREATE INDEX IF NOT EXISTS idx_connector_secrets_connector
  ON connector_secrets(connector_id);

DROP TRIGGER IF EXISTS trg_connector_secrets_updated_at ON connector_secrets;
CREATE TRIGGER trg_connector_secrets_updated_at
  BEFORE UPDATE ON connector_secrets
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

COMMIT;

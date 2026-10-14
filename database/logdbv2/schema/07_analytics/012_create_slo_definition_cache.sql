-- Cache of service level objective targets synced for fast evaluation
CREATE TABLE IF NOT EXISTS slo_definition_cache (
  slo_id          UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  project_id      UUID NOT NULL,
  environment     TEXT NOT NULL,
  target          NUMERIC(6,4) NOT NULL,
  window_days     INTEGER NOT NULL,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slo_definition_cache_tenant
  ON slo_definition_cache (organization_id, project_id, environment);

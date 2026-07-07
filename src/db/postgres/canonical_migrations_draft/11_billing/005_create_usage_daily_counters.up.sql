BEGIN;

CREATE TABLE IF NOT EXISTS usage_daily_counters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  events_count BIGINT NOT NULL DEFAULT 0,
  ai_analyses_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_usage_daily_counters_scope UNIQUE (org_id, project_id, date)
);

CREATE INDEX IF NOT EXISTS idx_usage_org_date_brin
  ON usage_daily_counters USING BRIN (date);
CREATE INDEX IF NOT EXISTS idx_usage_org_lookup
  ON usage_daily_counters(org_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_usage_project_lookup
  ON usage_daily_counters(project_id, date DESC);

DROP TRIGGER IF EXISTS trg_usage_daily_counters_updated_at ON usage_daily_counters;
CREATE TRIGGER trg_usage_daily_counters_updated_at
  BEFORE UPDATE ON usage_daily_counters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

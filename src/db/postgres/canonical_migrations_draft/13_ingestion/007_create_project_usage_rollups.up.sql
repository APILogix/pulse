BEGIN;

CREATE TABLE IF NOT EXISTS project_usage (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  org_id UUID NOT NULL,
  counter_type VARCHAR(64) NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  value BIGINT NOT NULL DEFAULT 0 CHECK (value >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id),
  UNIQUE (project_id, counter_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_project_usage_lookup
  ON project_usage(project_id, counter_type, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_project_usage_org
  ON project_usage(org_id, period_start DESC);

DROP TRIGGER IF EXISTS trg_project_usage_updated_at ON project_usage;
CREATE TRIGGER trg_project_usage_updated_at
  BEFORE UPDATE ON project_usage
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

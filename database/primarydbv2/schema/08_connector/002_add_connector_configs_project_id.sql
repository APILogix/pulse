ALTER TABLE connector_configs
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_connector_project
  ON connector_configs (project_id)
  WHERE deleted_at IS NULL AND project_id IS NOT NULL;

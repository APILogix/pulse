BEGIN;

CREATE TABLE IF NOT EXISTS project_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  retention_days INTEGER DEFAULT 30,
  max_events_per_second INTEGER DEFAULT 1000,
  auto_archive BOOLEAN DEFAULT FALSE,
  alerting_enabled BOOLEAN DEFAULT TRUE,
  ingestion_enabled BOOLEAN DEFAULT TRUE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_settings_project
  ON project_settings(project_id);
CREATE INDEX IF NOT EXISTS idx_project_settings_org
  ON project_settings(organization_id);

COMMENT ON TABLE project_settings IS 'Per-project configuration and operational limits';

COMMIT;

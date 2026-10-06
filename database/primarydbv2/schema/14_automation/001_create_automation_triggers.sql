-- Normalized final definition for automation_triggers.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/19_automation/004_automation_triggers.sql

CREATE TABLE IF NOT EXISTS automation_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  workflow_version_id UUID NULL REFERENCES automation_workflow_versions(id) ON DELETE CASCADE,
  trigger_kind automation_trigger_kind NOT NULL,
  trigger_type VARCHAR(120) NOT NULL,
  source_module VARCHAR(80) NOT NULL,
  source_event VARCHAR(120),
  schedule_cron VARCHAR(120),
  timezone VARCHAR(80) NOT NULL DEFAULT 'UTC',
  webhook_secret_hash VARCHAR(255),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  dedupe_key_template VARCHAR(500),
  cooldown_seconds INTEGER NOT NULL DEFAULT 0,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT chk_trigger_schedule_cron CHECK (
  trigger_kind != 'schedule' OR schedule_cron IS NOT NULL
  ),
  CONSTRAINT chk_trigger_event_source CHECK (
  trigger_kind != 'event' OR source_event IS NOT NULL
  ),
  CONSTRAINT chk_trigger_cooldown_nonneg CHECK (cooldown_seconds >= 0)
);

CREATE INDEX IF NOT EXISTS idx_automation_triggers_source
  ON automation_triggers(source_module, source_event, is_enabled)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_triggers_workflow
  ON automation_triggers(workflow_id, is_enabled)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_triggers_kind_type
  ON automation_triggers(trigger_kind, trigger_type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_triggers_config
  ON automation_triggers USING GIN (config);

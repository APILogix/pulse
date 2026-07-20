-- =============================================================================
-- Module      : Enterprise Ingestion / Alerting
-- Migration   : 002_alerting_project_scope.up.sql
-- Description : Project-level scoping for alert rules and alert events, plus
--               default-rule (preset) bookkeeping and evaluator watermarks.
--
-- Justification:
-- * The alerting spec requires project isolation: rules are evaluated within
--   the correct project and members only receive alerts for projects they
--   belong to. alert_rules/alert_events had no project dimension at all.
-- * preset_key/is_default let the platform ship built-in alert templates that
--   organizations can customize or disable without losing track of which rows
--   are platform-managed.
-- * last_evaluated_at is the watermark the scheduled rule evaluator uses to
--   slide lookback windows without re-scanning or double-firing.
-- =============================================================================

BEGIN;

-- ─── alert_rules ────────────────────────────────────────────────────────────

ALTER TABLE alert_rules
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS preset_key VARCHAR(64),
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_evaluated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_alert_rules_org_project
  ON alert_rules(organization_id, project_id)
  WHERE deleted_at IS NULL;

-- Evaluator scan: enabled rules due for evaluation.
CREATE INDEX IF NOT EXISTS idx_alert_rules_eval_due
  ON alert_rules(enabled, last_evaluated_at)
  WHERE deleted_at IS NULL;

-- One preset instance per (org, project, preset_key). NULLS NOT DISTINCT keeps
-- org-level presets (project_id IS NULL) singleton as well.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_rules_preset_scope
  ON alert_rules(organization_id, project_id, preset_key) NULLS NOT DISTINCT
  WHERE preset_key IS NOT NULL AND deleted_at IS NULL;

-- ─── alert_events ───────────────────────────────────────────────────────────

ALTER TABLE alert_events
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_alert_events_org_project_status
  ON alert_events(organization_id, project_id, status, created_at DESC);

COMMIT;

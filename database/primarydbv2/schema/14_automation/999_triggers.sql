-- Source: canonical_migrations_draft/19_automation/006_automation_actions.sql
DROP TRIGGER IF EXISTS trg_automation_actions_updated_at ON automation_actions;
CREATE TRIGGER trg_automation_actions_updated_at
  BEFORE UPDATE ON automation_actions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/19_automation/009_automation_approvals.sql
DROP TRIGGER IF EXISTS trg_automation_approvals_updated_at ON automation_approvals;
CREATE TRIGGER trg_automation_approvals_updated_at
  BEFORE UPDATE ON automation_approvals
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/19_automation/005_automation_conditions.sql
DROP TRIGGER IF EXISTS trg_automation_conditions_updated_at ON automation_conditions;
CREATE TRIGGER trg_automation_conditions_updated_at
  BEFORE UPDATE ON automation_conditions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/19_automation/010_automation_templates.sql
DROP TRIGGER IF EXISTS trg_automation_templates_updated_at ON automation_templates;
CREATE TRIGGER trg_automation_templates_updated_at
  BEFORE UPDATE ON automation_templates
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/19_automation/004_automation_triggers.sql
DROP TRIGGER IF EXISTS trg_automation_triggers_updated_at ON automation_triggers;
CREATE TRIGGER trg_automation_triggers_updated_at
  BEFORE UPDATE ON automation_triggers
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: canonical_migrations_draft/19_automation/003_automation_workflow_versions.sql
DROP TRIGGER IF EXISTS trg_immutable_published_version ON automation_workflow_versions;
CREATE TRIGGER trg_immutable_published_version
  BEFORE UPDATE ON automation_workflow_versions
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_immutable_published_version();

-- Source: canonical_migrations_draft/19_automation/002_automation_workflows.sql
DROP TRIGGER IF EXISTS trg_automation_workflows_updated_at ON automation_workflows;
CREATE TRIGGER trg_automation_workflows_updated_at
  BEFORE UPDATE ON automation_workflows
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: 002_create_automation_runtime.sql
DROP TRIGGER IF EXISTS trg_automation_runs_updated_at ON automation_runs;
CREATE TRIGGER trg_automation_runs_updated_at
  BEFORE UPDATE ON automation_runs
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_automation_run_steps_updated_at ON automation_run_steps;
CREATE TRIGGER trg_automation_run_steps_updated_at
  BEFORE UPDATE ON automation_run_steps
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


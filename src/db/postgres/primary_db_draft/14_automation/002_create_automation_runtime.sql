-- =============================================================================
-- Automation RUNTIME tables (PRIMARY database).
--
-- ROOT CAUSE THIS FIXES:
--   These four tables were previously created only in the LOG database
--   (database/migrations/logdb/08_automation_runtime/001_automation_runtime.up.sql)
--   as generic 16-column stubs that did not match the application code at all.
--   The application's AutomationRepository is constructed with the PRIMARY pool
--   (src/modules/automation/automation.module.ts -> new AutomationRepository(pool)),
--   and claimNextStep() JOINs automation_run_steps -> automation_runs ->
--   automation_workflows -> automation_actions. Those control-plane tables live in
--   the PRIMARY database, so a cross-database join is impossible: the runtime
--   tables MUST live here in PRIMARY alongside them.
--
--   Result before this migration: every inbox insert / claim / run creation /
--   step claim failed with "relation does not exist" against PRIMARY.
--
-- Column definitions below are derived directly from the SQL and row mappers in
-- src/modules/automation/repository.ts (toInboxEvent/toRun/toStep) and
-- src/modules/automation/audit.ts (toAuditRow), so the schema and code agree.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Inbox status enum (no pre-existing enum covered these values).
-- Values are exactly those written by repository.ts:
--   insertInboxEvent -> 'pending'
--   claimInboxEvents -> 'processing'
--   completeInboxEvent -> 'processed'
--   failInboxEvent -> 'retry' | 'failed'
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_inbox_status') THEN
    CREATE TYPE automation_inbox_status AS ENUM ('pending', 'processing', 'processed', 'retry', 'failed');
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- automation_events_inbox — durable trigger inbox (transactional outbox pattern).
-- Written by insertInboxEvent(); consumed by claimInboxEvents() with SKIP LOCKED.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_events_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable: repository.ts supports platform/system events with no org, and
  -- looks them up with `organization_id IS NOT DISTINCT FROM $2`.
  organization_id UUID NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_module VARCHAR(80) NOT NULL,
  event_type VARCHAR(120) NOT NULL,
  source_event_id VARCHAR(200),
  dedupe_key VARCHAR(300) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  status automation_inbox_status NOT NULL DEFAULT 'pending',
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by VARCHAR(120),
  processed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  last_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT chk_inbox_attempts_non_negative CHECK (attempts >= 0)
);

-- Required by `ON CONFLICT (organization_id, dedupe_key) DO NOTHING` in
-- insertInboxEvent(). NULLS NOT DISTINCT (PG15+) is essential: without it two
-- system events (organization_id IS NULL) sharing a dedupe_key would BOTH insert,
-- silently breaking deduplication for platform-scoped events.
CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_events_inbox_org_dedupe
  ON automation_events_inbox (organization_id, dedupe_key) NULLS NOT DISTINCT;

-- Serves the claimInboxEvents() ordering (ORDER BY received_at ASC) while
-- excluding already-terminal rows, which are the vast majority over time.
CREATE INDEX IF NOT EXISTS idx_automation_events_inbox_claimable
  ON automation_events_inbox (received_at)
  WHERE status IN ('pending', 'retry', 'processing');

-- Supports the retry-due predicate branch of the claim query.
CREATE INDEX IF NOT EXISTS idx_automation_events_inbox_retry_due
  ON automation_events_inbox (next_retry_at)
  WHERE status = 'retry';

CREATE INDEX IF NOT EXISTS idx_automation_events_inbox_org_received
  ON automation_events_inbox (organization_id, received_at DESC);

-- -----------------------------------------------------------------------------
-- automation_runs — one row per triggered workflow execution.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL,
  workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  workflow_version_id UUID NULL REFERENCES automation_workflow_versions(id) ON DELETE SET NULL,
  trigger_id UUID NULL REFERENCES automation_triggers(id) ON DELETE SET NULL,
  inbox_event_id UUID NULL REFERENCES automation_events_inbox(id) ON DELETE SET NULL,
  status automation_run_status NOT NULL DEFAULT 'queued',
  trigger_type VARCHAR(120) NOT NULL,
  source_module VARCHAR(80) NOT NULL,
  source_event_id VARCHAR(200),
  dedupe_key VARCHAR(300),
  -- NOT NULL + UNIQUE: createRunWithSteps() always supplies this and relies on a
  -- unique violation (mapped to AutomationConflictError) to make run creation
  -- effectively-once for a given (org, workflow, eventType, sourceEventId).
  idempotency_key VARCHAR(300) NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  attempt INTEGER NOT NULL DEFAULT 1,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code VARCHAR(80),
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_run_max_attempts_positive CHECK (max_attempts > 0),
  CONSTRAINT chk_run_attempt_positive CHECK (attempt > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_runs_idempotency_key
  ON automation_runs (idempotency_key);

-- Cooldown + hourly rate-limit gate in workers.ts processInbox():
--   WHERE workflow_id = $1 AND organization_id = $2 AND created_at > NOW() - interval
CREATE INDEX IF NOT EXISTS idx_automation_runs_workflow_org_created
  ON automation_runs (workflow_id, organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_runs_org_created
  ON automation_runs (organization_id, created_at DESC);

-- Stale-run recovery sweep scans non-terminal runs only.
CREATE INDEX IF NOT EXISTS idx_automation_runs_active
  ON automation_runs (status, updated_at)
  WHERE status IN ('queued', 'running', 'waiting_approval');

CREATE INDEX IF NOT EXISTS idx_automation_runs_expiry
  ON automation_runs (expires_at)
  WHERE expires_at IS NOT NULL AND status IN ('queued', 'running');

DROP TRIGGER IF EXISTS trg_automation_runs_updated_at ON automation_runs;
CREATE TRIGGER trg_automation_runs_updated_at
  BEFORE UPDATE ON automation_runs
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- automation_run_steps — ordered action steps within a run.
-- Claimed sequentially by claimNextStep() (FOR UPDATE OF s SKIP LOCKED).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_run_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  action_id UUID NULL REFERENCES automation_actions(id) ON DELETE SET NULL,
  step_key VARCHAR(100) NOT NULL,
  action_type VARCHAR(120) NOT NULL,
  status automation_step_status NOT NULL DEFAULT 'queued',
  sort_order INTEGER NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 1,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  timeout_at TIMESTAMPTZ,
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  approval_id UUID NULL REFERENCES automation_approvals(id) ON DELETE SET NULL,
  idempotency_key VARCHAR(300),
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code VARCHAR(80),
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_step_max_attempts_positive CHECK (max_attempts > 0),
  CONSTRAINT chk_step_attempt_positive CHECK (attempt > 0),
  CONSTRAINT chk_step_sort_order_non_negative CHECK (sort_order >= 0)
);

-- Matches `ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL`
-- in createRunWithSteps(). The predicate must match the statement exactly.
CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_run_steps_idempotency_key
  ON automation_run_steps (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- claimNextStep() orders by sort_order within a run and checks lower-order blockers.
CREATE INDEX IF NOT EXISTS idx_automation_run_steps_run_order
  ON automation_run_steps (run_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_automation_run_steps_claimable
  ON automation_run_steps (run_id, sort_order)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_automation_run_steps_timeout
  ON automation_run_steps (timeout_at)
  WHERE status = 'running' AND timeout_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_automation_run_steps_approval
  ON automation_run_steps (approval_id)
  WHERE approval_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_automation_run_steps_updated_at ON automation_run_steps;
CREATE TRIGGER trg_automation_run_steps_updated_at
  BEFORE UPDATE ON automation_run_steps
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- automation_audit_logs — immutable, append-only audit trail.
--
-- `action` is VARCHAR, deliberately NOT the pre-existing automation_audit_action
-- enum: that enum uses underscore labels ('run_queued') while the application
-- emits dotted values ('run.queued', 'run.dead_lettered' — the latter not present
-- in the enum at all). Typing this column as that enum would make every audit
-- insert fail. The app-layer AUDIT_ACTIONS union is the source of truth, and
-- keeping this VARCHAR avoids a migration for every new audit action.
--
-- FKs use ON DELETE SET NULL (never CASCADE) so deleting a workflow can never
-- erase its audit history.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL,
  workflow_id UUID NULL REFERENCES automation_workflows(id) ON DELETE SET NULL,
  run_id UUID NULL REFERENCES automation_runs(id) ON DELETE SET NULL,
  step_id UUID NULL REFERENCES automation_run_steps(id) ON DELETE SET NULL,
  approval_id UUID NULL REFERENCES automation_approvals(id) ON DELETE SET NULL,
  actor_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  actor_type VARCHAR(40) NOT NULL DEFAULT 'user',
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id UUID,
  request_id VARCHAR(120),
  ip_address INET,
  user_agent TEXT,
  before_state JSONB,
  after_state JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- listAuditLogs() filters by org and orders by occurred_at DESC.
CREATE INDEX IF NOT EXISTS idx_automation_audit_logs_org_occurred
  ON automation_audit_logs (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_audit_logs_workflow
  ON automation_audit_logs (workflow_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_audit_logs_run
  ON automation_audit_logs (run_id);

CREATE INDEX IF NOT EXISTS idx_automation_audit_logs_action
  ON automation_audit_logs (action, occurred_at DESC);

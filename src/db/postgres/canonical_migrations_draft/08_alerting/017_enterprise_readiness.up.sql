BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 017 — Enterprise readiness: schema/code parity fixes, escalation execution
-- state, throttling windows, dead-letter queue table, and performance indexes.
--
-- 1. FIX: alert_event_batches columns the worker code already uses
--    (event_ids, skipped_count, pg_boss_job_id) but 011 never created.
-- 2. Escalation execution state on alert_events (policy, step, repeats).
-- 3. alert_throttle_windows — per-rule-action notification rate limiting.
-- 4. alert_dead_letter_events — exhausted pg-boss jobs land here for audit +
--    operator retry/discard instead of disappearing.
-- 5. Indexes for every background sweep query (claim, stuck, expired-ack,
--    escalation, cleanup) so the workers stay fast at scale.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Batch table parity with events.repository.ts ──────────────────────────
ALTER TABLE alert_event_batches
  ADD COLUMN IF NOT EXISTS event_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS skipped_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pg_boss_job_id VARCHAR(255);

-- ── 2. Escalation execution state on alert_events ────────────────────────────
ALTER TABLE alert_events
  ADD COLUMN IF NOT EXISTS escalation_policy_id UUID REFERENCES alert_escalation_policies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS escalation_step_number INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escalation_repeat_count INTEGER NOT NULL DEFAULT 0;

-- ── 3. History actions for enterprise lifecycle events ───────────────────────
ALTER TYPE history_action ADD VALUE IF NOT EXISTS 'escalation_step';
ALTER TYPE history_action ADD VALUE IF NOT EXISTS 'throttled';
ALTER TYPE history_action ADD VALUE IF NOT EXISTS 'dead_lettered';
ALTER TYPE history_action ADD VALUE IF NOT EXISTS 'requeued';

-- ── 4. Dead-letter status enum ───────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_dead_letter_status') THEN
    CREATE TYPE alert_dead_letter_status AS ENUM ('pending_retry', 'retried', 'exhausted', 'discarded');
  END IF;
END $$;

-- ── 5. Throttle windows (per rule action, per hour bucket) ───────────────────
CREATE TABLE IF NOT EXISTS alert_throttle_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_action_id UUID NOT NULL REFERENCES alert_rule_actions(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  notification_count INTEGER NOT NULL DEFAULT 0,
  last_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_throttle_window UNIQUE (rule_action_id, window_start)
);

CREATE INDEX IF NOT EXISTS idx_alert_throttle_windows_action
  ON alert_throttle_windows(rule_action_id, window_start DESC);

DROP TRIGGER IF EXISTS trg_alert_throttle_windows_updated_at ON alert_throttle_windows;
CREATE TRIGGER trg_alert_throttle_windows_updated_at
  BEFORE UPDATE ON alert_throttle_windows
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ── 6. Dead-letter events (exhausted pg-boss jobs) ───────────────────────────
CREATE TABLE IF NOT EXISTS alert_dead_letter_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_queue VARCHAR(100) NOT NULL,
  pg_boss_job_id VARCHAR(255),
  batch_id UUID,
  event_ids UUID[] NOT NULL DEFAULT '{}',
  job_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  status alert_dead_letter_status NOT NULL DEFAULT 'pending_retry',
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  last_retry_at TIMESTAMPTZ,
  retried_at TIMESTAMPTZ,
  discarded_at TIMESTAMPTZ,
  discarded_by UUID REFERENCES users(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_dead_letter_org_status
  ON alert_dead_letter_events(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_dead_letter_retryable
  ON alert_dead_letter_events(status, created_at)
  WHERE status = 'pending_retry';

DROP TRIGGER IF EXISTS trg_alert_dead_letter_events_updated_at ON alert_dead_letter_events;
CREATE TRIGGER trg_alert_dead_letter_events_updated_at
  BEFORE UPDATE ON alert_dead_letter_events
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

-- ── 7. Performance indexes for worker sweep queries ──────────────────────────

-- createBatchFromPending: WHERE organization_id AND status='pending' ORDER BY created_at ASC
CREATE INDEX IF NOT EXISTS idx_alert_events_pending_claim
  ON alert_events(organization_id, created_at ASC)
  WHERE status = 'pending';

-- Orphan sweeper: events stuck in 'processing' (worker crash / job expiry)
CREATE INDEX IF NOT EXISTS idx_alert_events_stuck_processing
  ON alert_events(updated_at)
  WHERE status = 'processing';

-- Expired acknowledgments resuming escalation
CREATE INDEX IF NOT EXISTS idx_alert_events_expired_ack
  ON alert_events(acknowledgment_expires_at)
  WHERE status = 'acknowledged' AND acknowledgment_expires_at IS NOT NULL;

-- Escalation lookups by policy
CREATE INDEX IF NOT EXISTS idx_alert_events_escalation_policy
  ON alert_events(escalation_policy_id)
  WHERE escalation_policy_id IS NOT NULL;

-- Orphan sweeper: batches stuck in 'processing'
CREATE INDEX IF NOT EXISTS idx_alert_event_batches_stuck
  ON alert_event_batches(started_at)
  WHERE status = 'processing';

-- Org-scoped delivery audit queries
CREATE INDEX IF NOT EXISTS idx_alert_delivery_attempts_org_created
  ON alert_delivery_attempts(organization_id, created_at DESC);

COMMIT;

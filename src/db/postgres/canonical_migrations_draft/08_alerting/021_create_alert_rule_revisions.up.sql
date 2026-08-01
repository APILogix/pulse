-- =============================================================================
-- Primary DB : P3 — alert_rule_revisions (rule/action versioning)
-- Architecture : docs/alerting-redesign/02-data-model.md §1 "alert_rule_revisions"
--                docs/alerting-redesign/00-inconsistency-register.md D8
-- Increment    : 2 (rule bindings + effective rule resolution)
-- Deviation    : file number corrected 020 -> 021, see DEVIATIONS.md DEV-001
--
-- Closes audit finding D8: rule and action changes were previously mutated in place with
-- only `updated_at` to show for it, so an alert could not be explained against the rule
-- version that actually produced it. Each revision stores a full snapshot; alert events
-- record the revision they executed.
--
-- Append-only by intent: there is no updated_at and no soft delete. Revisions are pruned
-- with the rule via ON DELETE CASCADE.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS alert_rule_revisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id         UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  revision        INTEGER NOT NULL CHECK (revision >= 1),
  -- Which part of the rule aggregate changed.
  change_kind     VARCHAR(40) NOT NULL,
  -- Full rule + conditions + actions + bindings at this revision.
  snapshot        JSONB NOT NULL,
  actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_alert_rule_revision UNIQUE (rule_id, revision),
  CONSTRAINT ck_alert_rule_revision_change_kind CHECK (
    change_kind IN ('rule','condition','action','binding')
  ),
  CONSTRAINT ck_alert_rule_revision_snapshot CHECK (
    jsonb_typeof(snapshot) = 'object'
  )
);

CREATE INDEX IF NOT EXISTS idx_alert_rule_revisions_rule
  ON alert_rule_revisions (rule_id, revision DESC);
CREATE INDEX IF NOT EXISTS idx_alert_rule_revisions_org
  ON alert_rule_revisions (organization_id, created_at DESC);

-- Current revision pointer on the rule itself. Existing rows start at 1, which is
-- consistent with "the rule as it exists today is revision 1".
ALTER TABLE alert_rules
  ADD COLUMN IF NOT EXISTS current_revision INTEGER NOT NULL DEFAULT 1;

ALTER TABLE alert_rules
  DROP CONSTRAINT IF EXISTS ck_alert_rules_current_revision;
ALTER TABLE alert_rules
  ADD CONSTRAINT ck_alert_rules_current_revision CHECK (current_revision >= 1);

COMMENT ON TABLE alert_rule_revisions IS
  'Append-only version history for the rule aggregate (audit finding D8). Alert events '
  'record rule_revision so an alert stays explainable after the rule is edited.';

COMMIT;

-- =============================================================================
-- Primary DB : P1 — Alert scope / binding enums
-- Architecture : docs/alerting-redesign/02-data-model.md §1
--                docs/alerting-redesign/adr/0004-rule-inheritance-model.md
-- Increment    : 2 (rule bindings + effective rule resolution)
-- Deviation    : file number corrected 018 -> 019, see DEVIATIONS.md DEV-001
--
-- Additive only. Nothing reads these types until the bindings table (P2) exists, and
-- no evaluator consumes bindings until a later increment.
--
-- `notification_channel_kind` is created here with the SAME name and SAME value order
-- as the Log DB copy (logdb/00_shared/002_alerting_v2_types.up.sql) so channel values
-- translate 1:1 between databases with no mapping table (02-data-model.md §5).
-- =============================================================================

BEGIN;

DO $$
BEGIN
  -- Precedence ladder for effective rule resolution: organization=0 … endpoint=4.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_scope_type') THEN
    CREATE TYPE alert_scope_type AS ENUM (
      'organization','project','environment','service','endpoint'
    );
  END IF;

  -- inherit  : take the parent scope's value for every field left NULL
  -- override : replace the parent's value for the fields this binding sets
  -- disable   : stop the rule at this scope (a DEEPER override may re-enable it)
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_binding_mode') THEN
    CREATE TYPE alert_binding_mode AS ENUM ('inherit','override','disable');
  END IF;

  -- How a binding combines its actions with the parent scope's actions.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_action_merge_mode') THEN
    CREATE TYPE alert_action_merge_mode AS ENUM ('inherit','merge','replace');
  END IF;

  -- Rules request CHANNELS, never connector ids (ADR-0009).
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_channel_kind') THEN
    CREATE TYPE notification_channel_kind AS ENUM (
      'in_app','email','slack','discord','teams','pagerduty','webhook','sms'
    );
  END IF;
END $$;

COMMIT;

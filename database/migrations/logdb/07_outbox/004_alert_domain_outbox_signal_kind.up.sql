BEGIN;

-- =============================================================================
-- Widen telemetry_outbox to carry alert lifecycle domain events, reusing the
-- existing table instead of creating a new one.
--
-- WHY REUSE THIS TABLE RATHER THAN A DEDICATED ONE:
--   The Log DB is currently at its Neon project storage quota (512 MB). A
--   dedicated `alert_domain_outbox` table was the original design (see
--   docs/automationv2/27-alerting-automation-event-contract.md) but CREATE
--   TABLE fails live with "could not extend file because project size limit
--   has been exceeded" — verified by isolating the exact failing statement.
--   ALTER TABLE ... ADD CONSTRAINT on an EXISTING table is catalog-only and
--   allocates no new storage, so it succeeds under the same constraint.
--
-- WHY THIS IS SAFE (does not collide with telemetry_outbox's existing use):
--   - `fast_path` for these rows is always FALSE. TelemetryOutboxRelay's claim
--     query filters `WHERE fast_path = TRUE`, so it can never see or race with
--     alert domain event rows.
--   - AlertDomainOutboxRelay (new class) claims rows filtered by
--     `signal_kind = 'alert_domain_event'` exclusively — disjoint from every
--     other signal_kind, so it never competes with the telemetry relay either.
--   - `event_id` carries the dedupe key (`alert:{eventType}:{idempotency_key}`),
--     which fits the existing `uq_telemetry_outbox_idem
--     (organization_id, signal_kind, event_id, created_at)` unique index
--     without any index change.
--
-- This is a disclosed compromise, not the preferred end state. If/when the Log
-- DB has storage headroom (plan upgrade, or pruning of existing large tables —
-- a data-retention decision out of scope here), migrating this to a dedicated
-- table is a mechanical follow-up: same relay logic, same claim semantics,
-- against a dedicated relation instead of a shared one filtered by signal_kind.
-- =============================================================================

ALTER TABLE telemetry_outbox
  DROP CONSTRAINT IF EXISTS ck_telemetry_outbox_signal_kind,
  ADD CONSTRAINT ck_telemetry_outbox_signal_kind CHECK (
    signal_kind IN (
      'error','cron_checkin','log','request','metric','message','span','trace',
      'profile','replay','error_group_regressed','alert_domain_event'
    )
  );

COMMENT ON TABLE telemetry_outbox IS
  'Committed telemetry, semantic error-group signals, and alert lifecycle domain events (signal_kind=alert_domain_event, fast_path=FALSE) for at-least-once downstream publication.';

COMMIT;

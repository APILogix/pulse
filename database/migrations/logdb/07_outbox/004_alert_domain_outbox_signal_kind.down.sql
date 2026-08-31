BEGIN;

ALTER TABLE telemetry_outbox
  DROP CONSTRAINT IF EXISTS ck_telemetry_outbox_signal_kind,
  ADD CONSTRAINT ck_telemetry_outbox_signal_kind CHECK (
    signal_kind IN (
      'error','cron_checkin','log','request','metric','message','span','trace',
      'profile','replay','error_group_regressed'
    )
  );

COMMENT ON TABLE telemetry_outbox IS
  'Committed telemetry and semantic error-group signals for at-least-once alert publication.';

COMMIT;

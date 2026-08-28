BEGIN;

-- codex-logdb-migration: requires-operator-drain

-- Add the retry identity guard missing from events_logs.
--
-- Identity scope matches deterministicEventId(): organization, project and
-- environment identify the tenant stream; event_id identifies the SDK event;
-- occurred_at is required by PostgreSQL because events_logs is range
-- partitioned on that column.
--
-- SAFETY: CREATE INDEX on a partitioned parent is non-concurrent. A populated
-- table therefore requires an explicit operator assertion that ingestion is
-- drained. Automatic worker startup recognizes the directive above and
-- defers this file without scanning, DDL, or a ledger insert. Explicit operator
-- execution still fails before duplicate scanning or DDL without the session
-- assertion. Empty/fresh databases may proceed in operator mode without it.
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  table_has_rows BOOLEAN;
  duplicate_groups BIGINT;
  surplus_rows BIGINT;
BEGIN
  SELECT EXISTS (SELECT 1 FROM events_logs LIMIT 1)
    INTO table_has_rows;

  IF table_has_rows
     AND COALESCE(
       current_setting('pulse.events_logs_identity_drain_confirmed', true),
       ''
     ) <> 'on' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'events_logs identity migration requires a confirmed ingestion drain',
      DETAIL = 'No duplicate scan or index DDL was executed.',
      HINT = 'Stop ingestion producers and workers, drain active writes, then set pulse.events_logs_identity_drain_confirmed=on for this migration session.';
  END IF;

  SELECT
    COUNT(*)::BIGINT,
    COALESCE(SUM(group_size - 1), 0)::BIGINT
  INTO duplicate_groups, surplus_rows
  FROM (
    SELECT COUNT(*)::BIGINT AS group_size
    FROM events_logs
    GROUP BY organization_id, project_id, environment, event_id, occurred_at
    HAVING COUNT(*) > 1
  ) AS duplicates;

  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = format(
        'events_logs scoped identity preflight failed: %s duplicate group(s), %s surplus row(s)',
        duplicate_groups,
        surplus_rows
      ),
      DETAIL = 'No rows were deleted and the unique index was not created.',
      HINT = 'Archive and remediate only exact scoped duplicates, re-run the preflight, then retry while ingestion remains drained.';
  END IF;
END
$$;

-- Keep the existing non-unique idx_events_logs_event lookup index. Its removal
-- requires separate query-plan and observation-window evidence.
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_logs_event_unique
  ON events_logs (
    organization_id,
    project_id,
    environment,
    event_id,
    occurred_at
  );

COMMIT;

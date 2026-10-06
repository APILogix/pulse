-- Normalized final definition for alert_incident_events.
--
-- FILENAME PREFIX IS LOAD-BEARING: this file is `002_`, not `001_`.
-- run-primary-draft-folder.ts applies a folder's .sql files in LEXICOGRAPHIC
-- order. As `001_create_alert_incident_events.sql` this sorted BEFORE
-- `001_create_alert_incidents.sql` ('_' = 0x5F < 's' = 0x73), so the FK below
-- referenced a table that did not exist yet and the run failed with
-- 42P01 relation "alert_incidents" does not exist.
-- Any table with an FK to another table in this same folder must sort after it.
--
-- Durable incident LIFECYCLE timeline, co-located with alert_incidents in the
-- PRIMARY database.
--
-- WHY THIS TABLE EXISTS (and is not just a read of the Log DB):
--   The incident timeline was previously reconstructed from
--   `alert_event_history_v2` in the Log DB. That table is
--   `PARTITION BY RANGE (created_at)` and the Log DB's stated policy is that
--   "continuously growing event, usage, runtime, audit ... tables are
--   range-partitioned to support retention pruning"
--   (logdb/00_shared/001_foundation.up.sql). So incident timelines would be
--   silently pruned out from under resolved incidents - the exact failure mode
--   that put alert_incidents in the primary database in the first place.
--   Postmortems, MTTR analysis, and compliance review all need the lifecycle of
--   an incident to outlive telemetry retention.
--
-- SCOPE - deliberately narrow:
--   Only LIFECYCLE transitions live here (opened, breach re-observed,
--   acknowledged, assigned, resolved, escalated, notification-created). These
--   are a handful of rows per incident, so the table is low-volume and durable.
--   High-volume per-retry delivery attempts stay in the Log DB
--   (`alert_delivery_attempts_v2`), where partition pruning is correct: an
--   individual SMTP retry is evidence, not lifecycle. The incident detail view
--   therefore reads lifecycle from here (authoritative) and delivery attempts
--   from the Log DB (best-effort enrichment).
--
-- INGESTION SAFETY: written only from the alert worker process and from the
-- incident API, never from the ingestion request path. Volume is bounded by
-- incident count, not telemetry count.

CREATE TABLE IF NOT EXISTS alert_incident_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  incident_id       UUID NOT NULL REFERENCES alert_incidents(id) ON DELETE CASCADE,
  -- Denormalized tenancy so the activity feed can filter by tenant/project
  -- without joining alert_incidents on every row.
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id        UUID REFERENCES projects(id) ON DELETE CASCADE,

  /* Lifecycle event kind. Free-form VARCHAR rather than an enum because new
     lifecycle events are additive and should not require a type migration; the
     CHECK keeps it a closed set that is cheap to extend. */
  kind              VARCHAR(48) NOT NULL,
  actor_type        VARCHAR(16) NOT NULL DEFAULT 'worker',
  actor_user_id     UUID REFERENCES users(id) ON DELETE SET NULL,

  /* Small structured detail (occurrence count, observed value, reason).
     NOT a telemetry payload - evidence stays in the Log DB. */
  detail            JSONB NOT NULL DEFAULT '{}'::jsonb,

  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ck_alert_incident_event_kind CHECK (kind IN (
    'incident_opened',
    'condition_still_breaching',
    'incident_acknowledged',
    'incident_assigned',
    'incident_resolved',
    'incident_reopened',
    'incident_escalated',
    'notification_created',
    'notification_suppressed'
  )),
  CONSTRAINT ck_alert_incident_event_actor CHECK (
    actor_type IN ('worker', 'user', 'system', 'api')
  ),
  CONSTRAINT ck_alert_incident_event_detail CHECK (jsonb_typeof(detail) = 'object')
);

-- ── Query-driven indexes ────────────────────────────────────────────────────

-- Per-incident timeline, newest first. The incident detail page's only query.
CREATE INDEX IF NOT EXISTS idx_alert_incident_events_incident
  ON alert_incident_events (incident_id, occurred_at DESC);

-- Global Activity feed: tenant-scoped, newest first, optional kind filter.
CREATE INDEX IF NOT EXISTS idx_alert_incident_events_org_occurred
  ON alert_incident_events (organization_id, occurred_at DESC);

-- Project-filtered activity feed.
CREATE INDEX IF NOT EXISTS idx_alert_incident_events_org_project_occurred
  ON alert_incident_events (organization_id, project_id, occurred_at DESC)
  WHERE project_id IS NOT NULL;

-- Deliberately NOT indexed: kind, actor_type, actor_user_id. They are
-- low-selectivity facets that always co-occur with organization_id, so the
-- composites above already restrict the scan to a small tenant slice.

ALTER TABLE alert_incident_events SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.1
);

COMMENT ON TABLE alert_incident_events IS
  'Durable incident lifecycle timeline (PRIMARY db). Outlives Log DB telemetry retention. Lifecycle only - per-retry delivery attempts remain in alert_delivery_attempts_v2.';

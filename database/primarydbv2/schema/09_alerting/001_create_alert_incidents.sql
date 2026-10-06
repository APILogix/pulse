-- Normalized final definition for alert_incidents.
--
-- Incidents are APPLICATION/CONTROL-PLANE state and are therefore owned by the
-- PRIMARY database (ADR-0006). The Log DB keeps telemetry, evidence, and the
-- high-volume alert event facts; it must not be the authoritative incident store.
--
-- NAME COLLISION (deliberate, documented):
--   database/migrations/logdb/06_alert_runtime/005_incidents_preferences.up.sql
--   creates a table also called `alert_incidents` in the LOG DB. That table is
--   dead schema - no TypeScript reads or writes it - and it is unusable for this
--   purpose for two reasons:
--     1. it has no project_id, so incidents cannot be scoped to a project;
--     2. it declares a FULL `UNIQUE (organization_id, fingerprint)`, which
--        permanently blocks a SECOND incident for the same fingerprint after the
--        first one resolves. Recurrence is a core requirement, so a full unique
--        constraint is simply wrong here (see uq_alert_incident_active below).
--   The Log DB copy is slated for removal; it still has an inbound FK from
--   alert_correlation_groups, so removing it is a separate, sequenced migration.
--
-- WRITE-VOLUME NOTE (ingestion safety):
--   Rows here are created per DISTINCT ALERT IDENTITY (fingerprint), never per
--   telemetry event. Repeated matches update `last_seen_at`/`occurrence_count` on
--   an existing row instead of inserting. Explicit autovacuum parameters are set
--   at the bottom so this table's churn cannot starve autovacuum workers that
--   `pgboss.job` (also in this database) depends on.

-- Incident lifecycle states. Intentionally a small, closed vocabulary rather
-- than reusing the 8-value alert_event_status: an incident is an operational
-- occurrence with exactly three meaningful terminal-facing states.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_incident_status') THEN
    CREATE TYPE alert_incident_status AS ENUM ('open', 'acknowledged', 'resolved');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS alert_incidents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenancy. project_id is REQUIRED product semantics: the global incident list
  -- must be filterable by project, and incident authorization is project-scoped.
  -- Nullable only to represent a genuinely organization-level rule with no
  -- project scope; the fingerprint encodes the project either way.
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id            UUID REFERENCES projects(id) ON DELETE CASCADE,
  environment           VARCHAR(64),

  -- Provenance: which rule, at which revision, produced this incident.
  rule_id               UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
  rule_revision         INTEGER,
  binding_id            UUID REFERENCES alert_rule_bindings(id) ON DELETE SET NULL,

  -- Canonical alert identity from alertIdentityHash(). Already encodes
  -- org + project + environment + rule + policy revision + grouping dimensions,
  -- which is why the active-uniqueness index below does not need to repeat them.
  fingerprint           VARCHAR(255) NOT NULL,
  -- Human-readable grouping key ('global', or 'route=/users/:id|service=api').
  dimension_key         VARCHAR(500) NOT NULL DEFAULT 'global',

  status                alert_incident_status NOT NULL DEFAULT 'open',
  severity              alert_severity NOT NULL DEFAULT 'warning',
  title                 VARCHAR(500) NOT NULL,

  -- Grouping dimensions promoted to columns because the incident list filters
  -- and sorts on them at the database level.
  service               VARCHAR(255),
  route                 VARCHAR(500),

  -- Latest evaluation snapshot. Enough for the incident list/detail to render
  -- "current vs threshold" without querying the Log DB. NOT a telemetry dump.
  observed_value        NUMERIC(20,6),
  threshold_value       NUMERIC(20,6),

  occurrence_count      INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),

  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  acknowledged_at       TIMESTAMPTZ,
  acknowledged_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_to           UUID REFERENCES users(id) ON DELETE SET NULL,

  resolved_at           TIMESTAMPTZ,
  resolved_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_reason     VARCHAR(100),

  labels                JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Lifecycle integrity: a state and its timestamp cannot disagree. These are
  -- the DB-level guard against a partially-applied transition.
  CONSTRAINT ck_alert_incident_resolved_shape CHECK (
    (status = 'resolved' AND resolved_at IS NOT NULL)
    OR (status <> 'resolved' AND resolved_at IS NULL)
  ),
  CONSTRAINT ck_alert_incident_acknowledged_shape CHECK (
    status <> 'acknowledged' OR acknowledged_at IS NOT NULL
  ),
  CONSTRAINT ck_alert_incident_labels CHECK (jsonb_typeof(labels) = 'object')
);

-- ── Active-incident uniqueness (Phase 6) ────────────────────────────────────
-- THE correctness backstop. Repeated evaluations of the same logical alert must
-- not create duplicate ACTIVE incidents, and application-level
-- "SELECT then INSERT" is race-prone by construction.
--
-- PARTIAL on active statuses so that:
--   * at most ONE open/acknowledged incident exists per (org, fingerprint);
--   * unlimited RESOLVED history is retained, so a later breach legitimately
--     creates a NEW incident (recurrence). A full UNIQUE would forbid this -
--     that is the bug in the Log DB copy of this table.
--
-- fingerprint already encodes project/environment/rule/revision/dimensions, so
-- (organization_id, fingerprint) is the minimal correct key. organization_id is
-- kept as the leading column for tenant-scoped index locality.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_incident_active
  ON alert_incidents (organization_id, fingerprint)
  WHERE status IN ('open', 'acknowledged');

-- ── Query-driven indexes (Phase 5 / Phase 24) ───────────────────────────────
-- Every index below maps to a specific query this feature actually issues. No
-- index exists merely because a column exists.

-- Default incident list: tenant-scoped, newest first, optional status filter.
-- Serves `GET /alerts/incidents` with and without ?status=.
CREATE INDEX IF NOT EXISTS idx_alert_incidents_org_status_started
  ON alert_incidents (organization_id, status, started_at DESC);

-- Project-scoped list, the most common filtered view in the UI, and the
-- project-scoped authorization check.
CREATE INDEX IF NOT EXISTS idx_alert_incidents_org_project_started
  ON alert_incidents (organization_id, project_id, started_at DESC);

-- "Active incidents" widgets (overview page counts, rule health) and the
-- resolve-by-fingerprint path in the evaluator. Partial: only active rows are
-- ever queried this way, which keeps the index small on a table whose bulk is
-- resolved history.
CREATE INDEX IF NOT EXISTS idx_alert_incidents_active_lookup
  ON alert_incidents (organization_id, fingerprint, status)
  WHERE status IN ('open', 'acknowledged');

-- Per-rule incident counts + "last triggered" on the Alert Rules page.
CREATE INDEX IF NOT EXISTS idx_alert_incidents_rule
  ON alert_incidents (rule_id, started_at DESC)
  WHERE rule_id IS NOT NULL;

-- Severity facet on the incident list, and critical-incident overview counts.
CREATE INDEX IF NOT EXISTS idx_alert_incidents_org_severity_started
  ON alert_incidents (organization_id, severity, started_at DESC);

-- `sortBy=lastSeenAt` (the other supported sort) and the recency feed.
CREATE INDEX IF NOT EXISTS idx_alert_incidents_org_last_seen
  ON alert_incidents (organization_id, last_seen_at DESC);

-- "Resolved today" / MTTR-style overview metrics over a bounded window.
CREATE INDEX IF NOT EXISTS idx_alert_incidents_org_resolved
  ON alert_incidents (organization_id, resolved_at DESC)
  WHERE resolved_at IS NOT NULL;

-- Deliberately NOT indexed:
--   environment, service, route, assigned_to, dimension_key
-- These are low-selectivity secondary facets that always co-occur with
-- organization_id, so the leading composite indexes above already restrict the
-- scan to a small tenant slice. Add them only if EXPLAIN on real data shows a
-- problem; each costs write amplification on an alerting write path.

-- ── Autovacuum (ingestion safety) ───────────────────────────────────────────
-- Active incidents are updated repeatedly (last_seen_at/occurrence_count), so
-- this table produces dead tuples out of proportion to its row count. Tighter
-- per-table thresholds keep its bloat local and stop it from monopolising the
-- shared autovacuum workers that pgboss.job (same database) relies on.
ALTER TABLE alert_incidents SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.05
);

COMMENT ON TABLE alert_incidents IS
  'Authoritative incident lifecycle (PRIMARY db). One ACTIVE row per canonical alert fingerprint, enforced by uq_alert_incident_active; resolved rows are retained so recurrence creates a new incident.';
COMMENT ON COLUMN alert_incidents.fingerprint IS
  'Canonical alert identity from alertIdentityHash(): org:project:env:rule:policy:dimensionKey.';
COMMENT ON COLUMN alert_incidents.occurrence_count IS
  'Number of matched evaluations folded into this incident. Incremented on reuse, never by inserting a new row.';

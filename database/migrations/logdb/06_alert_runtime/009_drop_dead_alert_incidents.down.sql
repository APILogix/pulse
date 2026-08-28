-- ============================================================================
-- 009_drop_dead_alert_incidents (Log DB) -- DOWN
--
-- Restores the Log DB `alert_incidents` and `alert_correlation_groups` tables to
-- their pre-009 shape (as defined by 005_incidents_preferences.up.sql).
--
-- IMPORTANT: this restores SCHEMA ONLY, not data. 009 refuses to run when either
-- table is non-empty, so under normal operation there is no data to lose - but
-- if the guard was deliberately removed, that data is gone and this rollback
-- will not bring it back.
--
-- NOTE: the restored definitions carry the original defects on purpose - no
-- project_id, and a FULL `UNIQUE (organization_id, fingerprint)` that prevents an
-- incident from ever reopening for the same fingerprint. A down migration must
-- reproduce the previous state faithfully, not an improved one. Incidents remain
-- owned by the PRIMARY database regardless; nothing in the application reads
-- these tables.
--
-- ORDER: parent first, then the FK child (inverse of the up migration).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS alert_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  fingerprint VARCHAR(255) NOT NULL,
  title VARCHAR(500) NOT NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'resolved', 'closed')),
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_alert_incidents_org_state
  ON alert_incidents (organization_id, state, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS alert_correlation_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  correlation_key VARCHAR(255) NOT NULL,
  incident_id UUID NOT NULL REFERENCES alert_incidents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, correlation_key)
);

-- Retract the ownership note recorded by the up migration.
DELETE FROM logdb_schema_notes WHERE subject = 'alert_incident_ownership';

COMMIT;

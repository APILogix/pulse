BEGIN;

-- ============================================================================
-- 1. SEQUENCES FOR PUBLIC ID GENERATION
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS seq_pubid_requests START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_errors START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_error_groups START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_traces START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_spans START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_logs START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_metrics START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_messages START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_replays START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_profiles START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_pubid_cron_checkins START WITH 1 INCREMENT BY 1;

-- ============================================================================
-- 2. ALTER TABLES TO ADD PUBLIC_ID COLUMN WITH DEFAULT SEQUENCE
-- ============================================================================

-- 2.1 events_requests (REQ)
ALTER TABLE events_requests
  ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('REQ-' || lpad(nextval('seq_pubid_requests')::text, 9, '0'));

-- 2.2 events_errors (ERR)
ALTER TABLE events_errors
  ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('ERR-' || lpad(nextval('seq_pubid_errors')::text, 9, '0'));

-- 2.3 error_groups / analytics_error_groups (ISS)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'error_groups') THEN
    ALTER TABLE error_groups
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('ISS-' || lpad(nextval('seq_pubid_error_groups')::text, 9, '0'));
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'analytics_error_groups') THEN
    ALTER TABLE analytics_error_groups
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('ISS-' || lpad(nextval('seq_pubid_error_groups')::text, 9, '0'));
  END IF;
END $$;

-- 2.4 events_traces (TRC)
ALTER TABLE events_traces
  ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('TRC-' || lpad(nextval('seq_pubid_traces')::text, 9, '0'));

-- 2.5 events_spans (SPN)
ALTER TABLE events_spans
  ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('SPN-' || lpad(nextval('seq_pubid_spans')::text, 9, '0'));

-- 2.6 events_logs (LOG)
ALTER TABLE events_logs
  ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('LOG-' || lpad(nextval('seq_pubid_logs')::text, 9, '0'));

-- 2.7 events_metrics (MTR)
ALTER TABLE events_metrics
  ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('MTR-' || lpad(nextval('seq_pubid_metrics')::text, 9, '0'));

-- 2.8 events_messages (MSG)
ALTER TABLE events_messages
  ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('MSG-' || lpad(nextval('seq_pubid_messages')::text, 9, '0'));

-- 2.9 events_replays (RPL)
ALTER TABLE events_replays
  ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('RPL-' || lpad(nextval('seq_pubid_replays')::text, 9, '0'));

-- 2.10 events_profiles (PRF)
ALTER TABLE events_profiles
  ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('PRF-' || lpad(nextval('seq_pubid_profiles')::text, 9, '0'));

-- 2.11 events_cron_checkins (CRN)
ALTER TABLE events_cron_checkins
  ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('CRN-' || lpad(nextval('seq_pubid_cron_checkins')::text, 9, '0'));

-- ============================================================================
-- 3. INDEXES FOR PUBLIC ID LOOKUPS
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_events_requests_pubid
    ON events_requests (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_errors_pubid
    ON events_errors (organization_id, project_id, public_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'error_groups') THEN
    CREATE INDEX IF NOT EXISTS idx_error_groups_pubid
      ON error_groups (organization_id, project_id, public_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'analytics_error_groups') THEN
    CREATE INDEX IF NOT EXISTS idx_analytics_error_groups_pubid
      ON analytics_error_groups (organization_id, project_id, public_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_events_traces_pubid
    ON events_traces (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_spans_pubid
    ON events_spans (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_logs_pubid
    ON events_logs (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_metrics_pubid
    ON events_metrics (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_messages_pubid
    ON events_messages (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_replays_pubid
    ON events_replays (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_profiles_pubid
    ON events_profiles (organization_id, project_id, public_id);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_pubid
    ON events_cron_checkins (organization_id, project_id, public_id);

COMMIT;

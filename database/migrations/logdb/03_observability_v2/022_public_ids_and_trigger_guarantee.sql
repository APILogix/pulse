BEGIN;

-- ============================================================================
-- 1. ENSURE ALL SEQUENCES EXIST
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
CREATE SEQUENCE IF NOT EXISTS seq_pubid_sessions START WITH 1 INCREMENT BY 1;

-- ============================================================================
-- 2. ENSURE ALL TABLES HAVE PUBLIC_ID COLUMN WITH DEFAULT
-- ============================================================================

-- 2.1 events_requests
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'events_requests') THEN
    ALTER TABLE events_requests
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('REQ-' || lpad(nextval('seq_pubid_requests')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_events_requests_pubid ON events_requests (organization_id, project_id, public_id);
  END IF;
END $$;

-- 2.2 events_errors
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'events_errors') THEN
    ALTER TABLE events_errors
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('ERR-' || lpad(nextval('seq_pubid_errors')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_events_errors_pubid ON events_errors (organization_id, project_id, public_id);
  END IF;
END $$;

-- 2.3 events_traces
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'events_traces') THEN
    ALTER TABLE events_traces
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('TRC-' || lpad(nextval('seq_pubid_traces')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_events_traces_pubid ON events_traces (organization_id, project_id, public_id);
  END IF;
END $$;

-- 2.4 events_spans
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'events_spans') THEN
    ALTER TABLE events_spans
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('SPN-' || lpad(nextval('seq_pubid_spans')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_events_spans_pubid ON events_spans (organization_id, project_id, public_id);
  END IF;
END $$;

-- 2.5 events_logs
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'events_logs') THEN
    ALTER TABLE events_logs
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('LOG-' || lpad(nextval('seq_pubid_logs')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_events_logs_pubid ON events_logs (organization_id, project_id, public_id);
  END IF;
END $$;

-- 2.6 events_metrics
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'events_metrics') THEN
    ALTER TABLE events_metrics
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('MTR-' || lpad(nextval('seq_pubid_metrics')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_events_metrics_pubid ON events_metrics (organization_id, project_id, public_id);
  END IF;
END $$;

-- 2.7 events_messages
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'events_messages') THEN
    ALTER TABLE events_messages
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('MSG-' || lpad(nextval('seq_pubid_messages')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_events_messages_pubid ON events_messages (organization_id, project_id, public_id);
  END IF;
END $$;

-- 2.8 events_replays
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'events_replays') THEN
    ALTER TABLE events_replays
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('RPL-' || lpad(nextval('seq_pubid_replays')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_events_replays_pubid ON events_replays (organization_id, project_id, public_id);
  END IF;
END $$;

-- 2.9 events_profiles
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'events_profiles') THEN
    ALTER TABLE events_profiles
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('PRF-' || lpad(nextval('seq_pubid_profiles')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_events_profiles_pubid ON events_profiles (organization_id, project_id, public_id);
  END IF;
END $$;

-- 2.10 events_cron_checkins
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'events_cron_checkins') THEN
    ALTER TABLE events_cron_checkins
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('CRN-' || lpad(nextval('seq_pubid_cron_checkins')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_pubid ON events_cron_checkins (organization_id, project_id, public_id);
  END IF;
END $$;

-- 2.11 analytics_error_groups / error_groups
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'analytics_error_groups') THEN
    ALTER TABLE analytics_error_groups
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('ISS-' || lpad(nextval('seq_pubid_error_groups')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_analytics_error_groups_pubid ON analytics_error_groups (organization_id, project_id, public_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'error_groups') THEN
    ALTER TABLE error_groups
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('ISS-' || lpad(nextval('seq_pubid_error_groups')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_error_groups_pubid ON error_groups (organization_id, project_id, public_id);
  END IF;
END $$;

-- 2.12 analytics_user_sessions
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'analytics_user_sessions') THEN
    ALTER TABLE analytics_user_sessions
      ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT ('SES-' || lpad(nextval('seq_pubid_sessions')::text, 9, '0'));
    CREATE INDEX IF NOT EXISTS idx_analytics_user_sessions_pubid ON analytics_user_sessions (organization_id, public_id);
  END IF;
END $$;

-- ============================================================================
-- 3. TRIGGER FUNCTIONS WITH GUARANTEED AUTO-INSERT FOR PUBLIC_ID
-- ============================================================================

-- 3.1 Main Typed Events Contract Function
CREATE OR REPLACE FUNCTION logdb_sync_typed_event_contract()
RETURNS trigger AS $$
BEGIN
  -- 1. Sync timestamps
  NEW.occurred_at := COALESCE(NEW.occurred_at, NOW());
  NEW.created_at := COALESCE(NEW.created_at, NEW.ingested_at, NOW());
  NEW.ingested_at := COALESCE(NEW.ingested_at, NEW.created_at);

  -- 2. Lock metadata environment
  NEW.metadata := jsonb_set(
    CASE WHEN jsonb_typeof(COALESCE(NEW.metadata, '{}'::jsonb)) = 'object'
      THEN COALESCE(NEW.metadata, '{}'::jsonb) ELSE '{}'::jsonb END,
    '{environment}', to_jsonb(NEW.environment), true
  );

  -- 3. Auto-generate public_id if not present or empty
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    IF TG_TABLE_NAME LIKE 'events_requests%' THEN
      NEW.public_id := 'REQ-' || lpad(nextval('seq_pubid_requests')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_errors%' THEN
      NEW.public_id := 'ERR-' || lpad(nextval('seq_pubid_errors')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_traces%' THEN
      NEW.public_id := 'TRC-' || lpad(nextval('seq_pubid_traces')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_spans%' THEN
      NEW.public_id := 'SPN-' || lpad(nextval('seq_pubid_spans')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_logs%' THEN
      NEW.public_id := 'LOG-' || lpad(nextval('seq_pubid_logs')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_metrics%' THEN
      NEW.public_id := 'MTR-' || lpad(nextval('seq_pubid_metrics')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_messages%' THEN
      NEW.public_id := 'MSG-' || lpad(nextval('seq_pubid_messages')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_replays%' THEN
      NEW.public_id := 'RPL-' || lpad(nextval('seq_pubid_replays')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_profiles%' THEN
      NEW.public_id := 'PRF-' || lpad(nextval('seq_pubid_profiles')::text, 9, '0');
    ELSIF TG_TABLE_NAME LIKE 'events_cron_checkins%' THEN
      NEW.public_id := 'CRN-' || lpad(nextval('seq_pubid_cron_checkins')::text, 9, '0');
    END IF;
  END IF;

  -- 4. Fallback payload
  IF NEW.payload IS NULL OR NEW.payload = '{}'::jsonb THEN
    NEW.payload := to_jsonb(NEW) - 'payload' - 'attributes' - 'metadata' - 'ai_response';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3.2 Error Groups Public ID Contract Function
CREATE OR REPLACE FUNCTION logdb_sync_error_groups_contract()
RETURNS trigger AS $$
BEGIN
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    NEW.public_id := 'ISS-' || lpad(nextval('seq_pubid_error_groups')::text, 9, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3.3 User Sessions Public ID Contract Function
CREATE OR REPLACE FUNCTION logdb_sync_user_sessions_contract()
RETURNS trigger AS $$
BEGIN
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    NEW.public_id := 'SES-' || lpad(nextval('seq_pubid_sessions')::text, 9, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply typed events trigger to all canonical event tables
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'events_requests',
    'events_errors',
    'events_logs',
    'events_metrics',
    'events_spans',
    'events_traces',
    'events_messages',
    'events_profiles',
    'events_replays',
    'events_cron_checkins'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_sync_typed_event_contract ON %I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_sync_typed_event_contract BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION logdb_sync_typed_event_contract()',
        t
      );
    END IF;
  END LOOP;
END $$;

-- Apply error groups trigger
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'analytics_error_groups') THEN
    DROP TRIGGER IF EXISTS trg_sync_error_groups_contract ON analytics_error_groups;
    CREATE TRIGGER trg_sync_error_groups_contract BEFORE INSERT OR UPDATE ON analytics_error_groups FOR EACH ROW EXECUTE FUNCTION logdb_sync_error_groups_contract();
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'error_groups') THEN
    DROP TRIGGER IF EXISTS trg_sync_error_groups_contract ON error_groups;
    CREATE TRIGGER trg_sync_error_groups_contract BEFORE INSERT OR UPDATE ON error_groups FOR EACH ROW EXECUTE FUNCTION logdb_sync_error_groups_contract();
  END IF;
END $$;

-- Apply user sessions trigger
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'analytics_user_sessions') THEN
    DROP TRIGGER IF EXISTS trg_sync_user_sessions_contract ON analytics_user_sessions;
    CREATE TRIGGER trg_sync_user_sessions_contract BEFORE INSERT OR UPDATE ON analytics_user_sessions FOR EACH ROW EXECUTE FUNCTION logdb_sync_user_sessions_contract();
  END IF;
END $$;

COMMIT;

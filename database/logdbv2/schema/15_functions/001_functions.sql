-- Shared LogDB contract and utility functions

-- 1. Timestamp management
CREATE OR REPLACE FUNCTION logdb_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Alert runtime idempotency reservation helper
CREATE OR REPLACE FUNCTION reserve_alert_runtime_idempotency(
  p_org_id UUID,
  p_idem_key VARCHAR(255),
  p_scope VARCHAR(64) DEFAULT 'notification_job',
  p_ttl INTERVAL DEFAULT INTERVAL '24 hours'
) RETURNS BOOLEAN AS $$
DECLARE
  v_inserted BOOLEAN;
BEGIN
  INSERT INTO alert_runtime_idempotency_keys(organization_id, scope, idempotency_key, created_at, expires_at)
  VALUES (p_org_id, p_scope, p_idem_key, NOW(), NOW() + p_ttl)
  ON CONFLICT (organization_id, scope, idempotency_key) DO NOTHING;
  
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted THEN
    RETURN TRUE;
  END IF;

  DELETE FROM alert_runtime_idempotency_keys
  WHERE organization_id = p_org_id
    AND scope = p_scope
    AND idempotency_key = p_idem_key
    AND expires_at < NOW();

  INSERT INTO alert_runtime_idempotency_keys(organization_id, scope, idempotency_key, created_at, expires_at)
  VALUES (p_org_id, p_scope, p_idem_key, NOW(), NOW() + p_ttl)
  ON CONFLICT (organization_id, scope, idempotency_key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$ LANGUAGE plpgsql;

-- 3. Fast typed-event contract trigger function (<2µs fast-path execution)
CREATE OR REPLACE FUNCTION logdb_sync_typed_event_contract()
RETURNS trigger AS $$
BEGIN
  -- 1. Immediate Fast-Path for Fully-Normalized Hot Path Ingestion
  IF NEW.occurred_at IS NOT NULL
     AND NEW.public_id IS NOT NULL AND NEW.public_id <> ''
     AND NEW.created_at IS NOT NULL
     AND NEW.ingested_at IS NOT NULL
     AND (NEW.payload IS NOT NULL AND NEW.payload <> '{}'::jsonb)
     AND (NEW.metadata IS NOT NULL AND NEW.metadata->>'environment' = NEW.environment) THEN
    RETURN NEW;
  END IF;

  -- 2. Slow-Path Fallback (Guarantees contract safety for ad-hoc / legacy / direct SQL)
  NEW.occurred_at := COALESCE(NEW.occurred_at, NOW());
  NEW.created_at := COALESCE(NEW.created_at, NEW.ingested_at, NOW());
  NEW.ingested_at := COALESCE(NEW.ingested_at, NEW.created_at);

  IF NEW.metadata IS NULL OR jsonb_typeof(NEW.metadata) <> 'object' THEN
    NEW.metadata := jsonb_build_object('environment', NEW.environment);
  ELSIF NEW.metadata->>'environment' IS DISTINCT FROM NEW.environment THEN
    NEW.metadata := jsonb_set(NEW.metadata, '{environment}', to_jsonb(NEW.environment), true);
  END IF;

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

  IF NEW.payload IS NULL OR NEW.payload = '{}'::jsonb THEN
    NEW.payload := to_jsonb(NEW) - 'payload' - 'attributes' - 'metadata' - 'ai_response';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Dedicated error groups contract function
CREATE OR REPLACE FUNCTION logdb_sync_error_groups_contract()
RETURNS trigger AS $$
BEGIN
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    NEW.public_id := 'ISS-' || lpad(nextval('seq_pubid_error_groups')::text, 9, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. User sessions contract function
CREATE OR REPLACE FUNCTION logdb_sync_user_sessions_contract()
RETURNS trigger AS $$
BEGIN
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    NEW.public_id := 'SES-' || lpad(nextval('seq_pubid_sessions')::text, 9, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Analytics partition management functions
CREATE OR REPLACE FUNCTION analytics_engine_partition_tables()
RETURNS TABLE (table_name TEXT, part_column TEXT, granularity TEXT) AS $fn$
BEGIN
  RETURN QUERY
  SELECT c.relname::TEXT,
         CASE
           WHEN c.relname = 'anomaly_detections'    THEN 'detected_at'
           WHEN c.relname = 'analytics_worker_runs' THEN 'started_at'
           ELSE 'bucket'
         END::TEXT,
         CASE
           WHEN c.relname LIKE '%\_1m' OR c.relname LIKE '%\_5m' THEN 'day'
           WHEN c.relname IN ('anomaly_detections', 'analytics_worker_runs')  THEN 'day'
           ELSE 'month'
         END::TEXT
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind = 'p'
     AND n.nspname = current_schema()
     AND (
       c.relname ~ '_metrics_(1m|5m|1h|1d)$'
       OR c.relname ~ '^metric_series_(1m|1h|1d)$'
       OR c.relname = 'project_health_5m'
       OR c.relname = 'anomaly_detections'
       OR c.relname = 'analytics_worker_runs'
     );
END;
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION analytics_engine_ensure_partitions(
  days_ahead INTEGER DEFAULT 7
) RETURNS INTEGER AS $fn$
DECLARE
  rec        RECORD;
  created    INTEGER := 0;
  d          DATE;
  m          DATE;
  part_name  TEXT;
  range_from TIMESTAMPTZ;
  range_to   TIMESTAMPTZ;
BEGIN
  IF days_ahead IS NULL OR days_ahead < 1 THEN
    days_ahead := 1;
  END IF;

  FOR rec IN SELECT * FROM analytics_engine_partition_tables() LOOP
    IF rec.granularity = 'day' THEN
      d := (NOW() AT TIME ZONE 'UTC')::DATE - 1;
      WHILE d <= (NOW() AT TIME ZONE 'UTC')::DATE + days_ahead LOOP
        part_name  := format('%s_p%s', rec.table_name, to_char(d, 'YYYYMMDD'));
        range_from := d::TIMESTAMPTZ;
        range_to   := (d + 1)::TIMESTAMPTZ;

        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
          EXECUTE format(
            'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
            part_name, rec.table_name, range_from, range_to);
          created := created + 1;
        END IF;
        d := d + 1;
      END LOOP;
    ELSE
      m := date_trunc('month', (NOW() AT TIME ZONE 'UTC')::DATE - INTERVAL '1 month')::DATE;
      WHILE m <= date_trunc('month', (NOW() AT TIME ZONE 'UTC')::DATE + days_ahead + 31)::DATE LOOP
        part_name  := format('%s_p%s', rec.table_name, to_char(m, 'YYYYMM'));
        range_from := m::TIMESTAMPTZ;
        range_to   := (m + INTERVAL '1 month')::TIMESTAMPTZ;

        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
          EXECUTE format(
            'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
            part_name, rec.table_name, range_from, range_to);
          created := created + 1;
        END IF;
        m := (m + INTERVAL '1 month')::DATE;
      END LOOP;
    END IF;
  END LOOP;

  RETURN created;
END;
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION analytics_engine_drop_partitions_before(
  p_table  TEXT,
  p_cutoff TIMESTAMPTZ
) RETURNS INTEGER AS $fn$
DECLARE
  rec     RECORD;
  dropped INTEGER := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM analytics_engine_partition_tables() WHERE table_name = p_table) THEN
    RAISE EXCEPTION 'Table % is not an analytics_engine partitioned table', p_table;
  END IF;

  FOR rec IN
    SELECT c.relname
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_class p ON p.oid = i.inhparent
     WHERE p.relname = p_table
       AND c.relname <> p_table || '_default'
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I', rec.relname);
    dropped := dropped + 1;
  END LOOP;

  RETURN dropped;
END;
$fn$ LANGUAGE plpgsql;

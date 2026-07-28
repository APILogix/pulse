BEGIN;

-- Forward-only convergence: ledgered migrations remain immutable. Rotation
-- lifecycle data is externalized before obsolete credential columns are removed.
CREATE TABLE IF NOT EXISTS project_api_key_rotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES project_environments(id) ON DELETE RESTRICT,
  old_key_id UUID NOT NULL,
  new_key_id UUID,
  state api_key_rotation_state NOT NULL DEFAULT 'rotating',
  reason TEXT,
  initiated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  grace_ends_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT project_api_key_rotations_distinct_keys CHECK (new_key_id IS NULL OR new_key_id <> old_key_id),
  CONSTRAINT project_api_key_rotations_state_check CHECK (
    state <> 'none'
    AND (state <> 'grace_period' OR grace_ends_at IS NOT NULL)
    AND (state <> 'completed' OR completed_at IS NOT NULL)
  )
);

INSERT INTO project_api_key_rotations(
  organization_id,project_id,environment_id,old_key_id,new_key_id,state,reason,
  initiated_by,initiated_at,grace_ends_at,completed_at
)
SELECT n.organization_id,n.project_id,n.environment_id,n.rotated_from_key_id,n.id,
       COALESCE(NULLIF(n.rotation_state,'none'::api_key_rotation_state),'completed'::api_key_rotation_state),n.rotation_reason,
       COALESCE(n.rotated_by,n.created_by),COALESCE(n.rotated_at,n.created_at),
       n.grace_period_ends_at,
       CASE WHEN COALESCE(NULLIF(n.rotation_state,'none'::api_key_rotation_state),'completed'::api_key_rotation_state)='completed'
            THEN COALESCE(n.rotated_at,n.updated_at,n.created_at) END
FROM project_api_keys n
JOIN project_api_keys o
  ON o.id=n.rotated_from_key_id
 AND o.project_id=n.project_id
 AND o.organization_id=n.organization_id
 AND o.environment_id=n.environment_id
WHERE n.rotated_from_key_id IS NOT NULL;
INSERT INTO project_api_key_rotations(
  organization_id,project_id,environment_id,old_key_id,new_key_id,state,reason,
  initiated_by,initiated_at,grace_ends_at,completed_at
)
SELECT k.organization_id,k.project_id,k.environment_id,k.id,NULL,
       COALESCE(NULLIF(k.rotation_state,'none'::api_key_rotation_state),'completed'::api_key_rotation_state),
       k.rotation_reason,k.rotated_by,COALESCE(k.rotated_at,k.updated_at,k.created_at),
       k.grace_period_ends_at,
       CASE WHEN COALESCE(NULLIF(k.rotation_state,'none'::api_key_rotation_state),'completed'::api_key_rotation_state)='completed'
            THEN COALESCE(k.rotated_at,k.updated_at,k.created_at) END
FROM project_api_keys k
WHERE (k.rotation_state <> 'none' OR k.status='rotated')
  AND NOT EXISTS (SELECT 1 FROM project_api_key_rotations r WHERE r.old_key_id=k.id);

CREATE INDEX IF NOT EXISTS idx_project_api_key_rotations_tenant_time
  ON project_api_key_rotations(organization_id,project_id,environment_id,initiated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_api_key_rotations_old_key
  ON project_api_key_rotations(old_key_id,initiated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_api_key_rotations_new_key
  ON project_api_key_rotations(new_key_id) WHERE new_key_id IS NOT NULL;

ALTER TABLE project_api_key_rotations
  ADD CONSTRAINT fk_project_api_key_rotations_old_key_tenant
  FOREIGN KEY(old_key_id,project_id,organization_id,environment_id)
  REFERENCES project_api_keys(id,project_id,organization_id,environment_id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_project_api_key_rotations_new_key_tenant
  FOREIGN KEY(new_key_id,project_id,organization_id,environment_id)
  REFERENCES project_api_keys(id,project_id,organization_id,environment_id) ON DELETE RESTRICT;

ALTER TABLE project_api_keys
  DROP CONSTRAINT IF EXISTS project_api_keys_lifecycle_check,
  DROP CONSTRAINT IF EXISTS project_api_keys_usage_count_check,
  DROP CONSTRAINT IF EXISTS project_api_keys_rate_limits_check,
  DROP CONSTRAINT IF EXISTS project_api_keys_auto_rotate_days_check;

DO $$
DECLARE obsolete_column TEXT;
BEGIN
  FOR obsolete_column IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='project_api_keys'
      AND column_name <> ALL(ARRAY[
        'id','organization_id','project_id','environment_id','name','public_key','secret_hash',
        'status','expires_at','last_used_at','created_by','rotated_from_key_id',
        'created_at','updated_at','deleted_at'
      ])
  LOOP
    EXECUTE format('ALTER TABLE project_api_keys DROP COLUMN IF EXISTS %I', obsolete_column);
  END LOOP;
END $$;

ALTER TABLE project_api_keys ALTER COLUMN name SET NOT NULL;
ALTER TABLE project_api_keys DROP CONSTRAINT IF EXISTS project_api_keys_lifecycle_check;
ALTER TABLE project_api_keys ADD CONSTRAINT project_api_keys_lifecycle_check CHECK (
  (rotated_from_key_id IS NULL OR rotated_from_key_id <> id)
  AND (expires_at IS NULL OR expires_at > created_at)
);
DROP TYPE IF EXISTS api_key_type;

COMMENT ON TABLE project_api_key_rotations IS
  'Append-oriented API-key rotation workflow/history; credentials retain only direct rotated_from_key_id lineage.';
COMMENT ON TABLE project_api_keys IS
  'Minimal project credential: tenant/environment identity, public lookup, secret verifier, lifecycle, and direct lineage only.';
-- Ordinary tables cannot be converted into partitioned parents. Stage every
-- legacy grain, rebuild the two physical facts, then expose aggregate views.
ALTER TABLE api_key_usage_minute RENAME TO api_key_usage_minute_legacy_018;
ALTER TABLE api_key_usage_hourly RENAME TO api_key_usage_hourly_legacy_018;
ALTER TABLE api_key_usage_daily RENAME TO api_key_usage_daily_legacy_018;
ALTER TABLE api_key_usage_monthly RENAME TO api_key_usage_monthly_legacy_018;
ALTER TABLE api_key_usage_minute_legacy_018 DROP CONSTRAINT IF EXISTS api_key_usage_minute_pkey;
ALTER TABLE api_key_usage_hourly_legacy_018 DROP CONSTRAINT IF EXISTS api_key_usage_hourly_pkey;
ALTER TABLE api_key_usage_daily_legacy_018 DROP CONSTRAINT IF EXISTS api_key_usage_daily_pkey;
ALTER TABLE api_key_usage_monthly_legacy_018 DROP CONSTRAINT IF EXISTS api_key_usage_monthly_pkey;

CREATE TEMP TABLE api_key_usage_legacy_018 (
  grain TEXT NOT NULL,
  api_key_id UUID NOT NULL,
  project_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  environment_id UUID NOT NULL,
  bucket TIMESTAMPTZ NOT NULL,
  event_type TEXT NOT NULL,
  request_count BIGINT NOT NULL,
  accepted_event_count BIGINT NOT NULL,
  error_event_count BIGINT NOT NULL,
  ingestion_failure_count BIGINT NOT NULL,
  accepted_bytes BIGINT NOT NULL,
  rate_limited_request_count BIGINT NOT NULL
) ON COMMIT DROP;

INSERT INTO api_key_usage_legacy_018
SELECT 'minute',api_key_id,project_id,organization_id,environment_id,bucket,
       COALESCE(NULLIF(btrim(event_type),''),'all'),requests,events,errors,0,bytes_ingested,rate_limited
FROM api_key_usage_minute_legacy_018;
INSERT INTO api_key_usage_legacy_018
SELECT 'hour',api_key_id,project_id,organization_id,environment_id,bucket,
       COALESCE(NULLIF(btrim(event_type),''),'all'),requests,events,errors,0,bytes_ingested,rate_limited
FROM api_key_usage_hourly_legacy_018;
INSERT INTO api_key_usage_legacy_018
SELECT 'day',api_key_id,project_id,organization_id,environment_id,bucket::timestamptz,
       COALESCE(NULLIF(btrim(event_type),''),'all'),requests,events,errors,0,bytes_ingested,rate_limited
FROM api_key_usage_daily_legacy_018;
INSERT INTO api_key_usage_legacy_018
SELECT 'month',api_key_id,project_id,organization_id,environment_id,bucket::timestamptz,
       COALESCE(NULLIF(btrim(event_type),''),'all'),requests,events,errors,0,bytes_ingested,rate_limited
FROM api_key_usage_monthly_legacy_018;

CREATE TABLE telemetry_event_types (
  id SMALLINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT telemetry_event_types_name_check CHECK (length(btrim(name)) > 0)
);
INSERT INTO telemetry_event_types(name) VALUES('all') ON CONFLICT(name) DO NOTHING;
INSERT INTO telemetry_event_types(name)
SELECT DISTINCT event_type FROM api_key_usage_legacy_018
WHERE length(btrim(event_type)) > 0 ON CONFLICT(name) DO NOTHING;

CREATE TABLE api_key_usage_minute (
  api_key_id UUID NOT NULL,
  project_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  environment_id UUID NOT NULL,
  bucket TIMESTAMPTZ NOT NULL,
  event_type_id SMALLINT NOT NULL REFERENCES telemetry_event_types(id) ON DELETE RESTRICT,
  request_count BIGINT NOT NULL DEFAULT 0,
  accepted_event_count BIGINT NOT NULL DEFAULT 0,
  error_event_count BIGINT NOT NULL DEFAULT 0,
  ingestion_failure_count BIGINT NOT NULL DEFAULT 0,
  accepted_bytes BIGINT NOT NULL DEFAULT 0,
  rate_limited_request_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(api_key_id,bucket,event_type_id),
  CONSTRAINT api_key_usage_minute_bucket_check CHECK (bucket=date_trunc('minute',bucket)),
  CONSTRAINT api_key_usage_minute_measures_check CHECK (
    request_count>=0 AND accepted_event_count>=0 AND error_event_count>=0
    AND ingestion_failure_count>=0 AND accepted_bytes>=0 AND rate_limited_request_count>=0
  ),
  CONSTRAINT fk_api_key_usage_minute_key_tenant FOREIGN KEY(
    api_key_id,project_id,organization_id,environment_id
  ) REFERENCES project_api_keys(id,project_id,organization_id,environment_id) ON DELETE CASCADE
) PARTITION BY RANGE(bucket);
CREATE TABLE api_key_usage_daily (
  api_key_id UUID NOT NULL,
  project_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  environment_id UUID NOT NULL,
  bucket DATE NOT NULL,
  event_type_id SMALLINT NOT NULL REFERENCES telemetry_event_types(id) ON DELETE RESTRICT,
  request_count BIGINT NOT NULL DEFAULT 0,
  accepted_event_count BIGINT NOT NULL DEFAULT 0,
  error_event_count BIGINT NOT NULL DEFAULT 0,
  ingestion_failure_count BIGINT NOT NULL DEFAULT 0,
  accepted_bytes BIGINT NOT NULL DEFAULT 0,
  rate_limited_request_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(api_key_id,bucket,event_type_id),
  CONSTRAINT api_key_usage_daily_measures_check CHECK (
    request_count>=0 AND accepted_event_count>=0 AND error_event_count>=0
    AND ingestion_failure_count>=0 AND accepted_bytes>=0 AND rate_limited_request_count>=0
  ),
  CONSTRAINT fk_api_key_usage_daily_key_tenant FOREIGN KEY(
    api_key_id,project_id,organization_id,environment_id
  ) REFERENCES project_api_keys(id,project_id,organization_id,environment_id) ON DELETE CASCADE
) PARTITION BY RANGE(bucket);

DO $$
DECLARE
  partition_start DATE;
  partition_end DATE;
  first_month DATE;
  last_month DATE;
  first_year DATE;
  last_year DATE;
BEGIN
  SELECT LEAST(COALESCE(date_trunc('month',MIN(bucket))::date,date_trunc('month',CURRENT_DATE)::date),
               (date_trunc('month',CURRENT_DATE)-INTERVAL '1 month')::date),
         GREATEST(COALESCE(date_trunc('month',MAX(bucket))::date,date_trunc('month',CURRENT_DATE)::date),
                  (date_trunc('month',CURRENT_DATE)+INTERVAL '1 month')::date)
    INTO first_month,last_month
  FROM api_key_usage_legacy_018 WHERE grain='minute';
  partition_start := first_month;
  WHILE partition_start <= last_month LOOP
    partition_end := (partition_start+INTERVAL '1 month')::date;
    EXECUTE format(
      'CREATE TABLE api_key_usage_minute_y%sm%s PARTITION OF api_key_usage_minute FOR VALUES FROM (%L) TO (%L)',
      to_char(partition_start,'YYYY'),to_char(partition_start,'MM'),partition_start,partition_end
    );
    partition_start := partition_end;
  END LOOP;

  SELECT LEAST(COALESCE(date_trunc('year',MIN(bucket))::date,date_trunc('year',CURRENT_DATE)::date),
               (date_trunc('year',CURRENT_DATE)-INTERVAL '2 years')::date),
         GREATEST(COALESCE(date_trunc('year',MAX(bucket))::date,date_trunc('year',CURRENT_DATE)::date),
                  (date_trunc('year',CURRENT_DATE)+INTERVAL '1 year')::date)
    INTO first_year,last_year
  FROM api_key_usage_legacy_018;
  partition_start := first_year;
  WHILE partition_start <= last_year LOOP
    partition_end := (partition_start+INTERVAL '1 year')::date;
    EXECUTE format(
      'CREATE TABLE api_key_usage_daily_y%s PARTITION OF api_key_usage_daily FOR VALUES FROM (%L) TO (%L)',
      to_char(partition_start,'YYYY'),partition_start,partition_end
    );
    partition_start := partition_end;
  END LOOP;
END $$;

CREATE INDEX idx_api_key_usage_minute_tenant_bucket
  ON api_key_usage_minute(organization_id,project_id,environment_id,bucket DESC);
CREATE INDEX idx_api_key_usage_minute_project_bucket
  ON api_key_usage_minute(project_id,bucket DESC);
CREATE INDEX idx_api_key_usage_daily_tenant_bucket
  ON api_key_usage_daily(organization_id,project_id,environment_id,bucket DESC);
CREATE INDEX idx_api_key_usage_daily_project_bucket
  ON api_key_usage_daily(project_id,bucket DESC);
CREATE OR REPLACE FUNCTION enforce_api_key_usage_tenant_dimensions() RETURNS trigger AS $$
DECLARE
  key_project_id UUID;
  key_organization_id UUID;
  key_environment_id UUID;
BEGIN
  SELECT project_id,organization_id,environment_id
    INTO key_project_id,key_organization_id,key_environment_id
  FROM project_api_keys WHERE id=NEW.api_key_id;
  IF NOT FOUND OR NEW.project_id<>key_project_id
     OR NEW.organization_id<>key_organization_id
     OR NEW.environment_id<>key_environment_id THEN
    RAISE EXCEPTION 'API-key usage tenant dimensions do not match credential %',NEW.api_key_id
      USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_api_key_usage_minute_tenant_dimensions
BEFORE INSERT OR UPDATE OF api_key_id,project_id,organization_id,environment_id
ON api_key_usage_minute FOR EACH ROW EXECUTE FUNCTION enforce_api_key_usage_tenant_dimensions();
CREATE TRIGGER trg_api_key_usage_daily_tenant_dimensions
BEFORE INSERT OR UPDATE OF api_key_id,project_id,organization_id,environment_id
ON api_key_usage_daily FOR EACH ROW EXECUTE FUNCTION enforce_api_key_usage_tenant_dimensions();

INSERT INTO api_key_usage_minute(
  api_key_id,project_id,organization_id,environment_id,bucket,event_type_id,
  request_count,accepted_event_count,error_event_count,ingestion_failure_count,
  accepted_bytes,rate_limited_request_count
)
SELECT l.api_key_id,l.project_id,l.organization_id,l.environment_id,date_trunc('minute',l.bucket),t.id,
       SUM(l.request_count),SUM(l.accepted_event_count),SUM(l.error_event_count),
       SUM(l.ingestion_failure_count),SUM(l.accepted_bytes),SUM(l.rate_limited_request_count)
FROM api_key_usage_legacy_018 l
JOIN telemetry_event_types t ON t.name=l.event_type
WHERE l.grain='minute'
GROUP BY l.api_key_id,l.project_id,l.organization_id,l.environment_id,date_trunc('minute',l.bucket),t.id;

WITH day_candidates AS (
  SELECT l.api_key_id,l.project_id,l.organization_id,l.environment_id,l.bucket::date bucket,t.id event_type_id,
         SUM(l.request_count) request_count,SUM(l.accepted_event_count) accepted_event_count,
         SUM(l.error_event_count) error_event_count,SUM(l.ingestion_failure_count) ingestion_failure_count,
         SUM(l.accepted_bytes) accepted_bytes,SUM(l.rate_limited_request_count) rate_limited_request_count,
         CASE l.grain WHEN 'day' THEN 1 WHEN 'hour' THEN 2 ELSE 3 END source_priority
  FROM api_key_usage_legacy_018 l
  JOIN telemetry_event_types t ON t.name=l.event_type
  WHERE l.grain IN ('minute','hour','day')
  GROUP BY l.api_key_id,l.project_id,l.organization_id,l.environment_id,l.bucket::date,t.id,l.grain
), preferred AS (
  SELECT DISTINCT ON(api_key_id,bucket,event_type_id)
         api_key_id,project_id,organization_id,environment_id,bucket,event_type_id,
         request_count,accepted_event_count,error_event_count,ingestion_failure_count,
         accepted_bytes,rate_limited_request_count
  FROM day_candidates
  ORDER BY api_key_id,bucket,event_type_id,source_priority
)
INSERT INTO api_key_usage_daily(
  api_key_id,project_id,organization_id,environment_id,bucket,event_type_id,
  request_count,accepted_event_count,error_event_count,ingestion_failure_count,
  accepted_bytes,rate_limited_request_count
)
SELECT api_key_id,project_id,organization_id,environment_id,bucket,event_type_id,
       request_count,accepted_event_count,error_event_count,ingestion_failure_count,
       accepted_bytes,rate_limited_request_count
FROM preferred;

INSERT INTO api_key_usage_daily(
  api_key_id,project_id,organization_id,environment_id,bucket,event_type_id,
  request_count,accepted_event_count,error_event_count,ingestion_failure_count,
  accepted_bytes,rate_limited_request_count
)
SELECT l.api_key_id,l.project_id,l.organization_id,l.environment_id,date_trunc('month',l.bucket)::date,t.id,
       SUM(l.request_count),SUM(l.accepted_event_count),SUM(l.error_event_count),
       SUM(l.ingestion_failure_count),SUM(l.accepted_bytes),SUM(l.rate_limited_request_count)
FROM api_key_usage_legacy_018 l
JOIN telemetry_event_types t ON t.name=l.event_type
WHERE l.grain='month'
  AND NOT EXISTS (
    SELECT 1 FROM api_key_usage_daily d
    WHERE d.api_key_id=l.api_key_id AND d.event_type_id=t.id
      AND date_trunc('month',d.bucket)=date_trunc('month',l.bucket)
  )
GROUP BY l.api_key_id,l.project_id,l.organization_id,l.environment_id,date_trunc('month',l.bucket)::date,t.id;
DROP TABLE api_key_usage_minute_legacy_018;
DROP TABLE api_key_usage_hourly_legacy_018;
DROP TABLE api_key_usage_daily_legacy_018;
DROP TABLE api_key_usage_monthly_legacy_018;

CREATE VIEW api_key_usage_hourly AS
SELECT m.api_key_id,m.project_id,m.organization_id,m.environment_id,
       date_trunc('hour',m.bucket) bucket,m.event_type_id,t.name event_type,
       SUM(m.request_count)::BIGINT request_count,
       SUM(m.accepted_event_count)::BIGINT accepted_event_count,
       SUM(m.error_event_count)::BIGINT error_event_count,
       SUM(m.ingestion_failure_count)::BIGINT ingestion_failure_count,
       SUM(m.accepted_bytes)::BIGINT accepted_bytes,
       SUM(m.rate_limited_request_count)::BIGINT rate_limited_request_count
FROM api_key_usage_minute m
JOIN telemetry_event_types t ON t.id=m.event_type_id
GROUP BY m.api_key_id,m.project_id,m.organization_id,m.environment_id,
         date_trunc('hour',m.bucket),m.event_type_id,t.name;

CREATE VIEW api_key_usage_monthly AS
SELECT d.api_key_id,d.project_id,d.organization_id,d.environment_id,
       date_trunc('month',d.bucket)::date bucket,d.event_type_id,t.name event_type,
       SUM(d.request_count)::BIGINT request_count,
       SUM(d.accepted_event_count)::BIGINT accepted_event_count,
       SUM(d.error_event_count)::BIGINT error_event_count,
       SUM(d.ingestion_failure_count)::BIGINT ingestion_failure_count,
       SUM(d.accepted_bytes)::BIGINT accepted_bytes,
       SUM(d.rate_limited_request_count)::BIGINT rate_limited_request_count
FROM api_key_usage_daily d
JOIN telemetry_event_types t ON t.id=d.event_type_id
GROUP BY d.api_key_id,d.project_id,d.organization_id,d.environment_id,
         date_trunc('month',d.bucket)::date,d.event_type_id,t.name;

COMMENT ON TABLE api_key_usage_minute IS
  'Physical monthly-partitioned API-key facts; retain 14 days and use additive UPSERT writes.';
COMMENT ON TABLE api_key_usage_daily IS
  'Physical yearly-partitioned API-key facts rebuilt from minute data; retain 25 months.';
COMMENT ON VIEW api_key_usage_hourly IS
  'Read-only hourly projection over api_key_usage_minute; never a write target.';
COMMENT ON VIEW api_key_usage_monthly IS
  'Read-only monthly projection over api_key_usage_daily; billing reads daily facts, not this dashboard view.';

-- Percentiles cannot be composed by SUM/MAX across buckets. Option 1 removes
-- them now; any future latency analytics must use a separate mergeable-sketch pipeline.
DO $$
DECLARE usage_table TEXT;
BEGIN
  FOREACH usage_table IN ARRAY ARRAY['project_usage_minute','project_usage_hourly','project_usage_daily'] LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',usage_table,usage_table||'_enterprise_metrics_check');
    EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS latency_ms_p50',usage_table);
    EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS latency_ms_p75',usage_table);
    EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS latency_ms_p90',usage_table);
    EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS latency_ms_p95',usage_table);
    EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS latency_ms_p99',usage_table);
    EXECUTE format($ddl$ALTER TABLE %I ADD CONSTRAINT %I CHECK (
      active_api_keys>=0 AND active_environments>=0 AND active_users>=0 AND active_members>=0
      AND alert_count>=0 AND connector_deliveries>=0 AND failed_notifications>=0 AND rate_limit_usage>=0
    )$ddl$,usage_table,usage_table||'_enterprise_metrics_check');
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION flush_usage_counters()
RETURNS TABLE(flushed_project_id UUID,flushed_count BIGINT) AS $$
BEGIN
  INSERT INTO telemetry_event_types(name)
  SELECT DISTINCT COALESCE(NULLIF(btrim(s.event_type),''),'all') FROM usage_counter_staging s
  WHERE s.created_at<NOW()-INTERVAL '5 seconds'
    AND s.counter_type NOT LIKE 'billing:%'
  ON CONFLICT(name) DO NOTHING;

  RETURN QUERY
  WITH batch AS (
    SELECT s.id,s.project_id,s.org_id,s.api_key_id,s.event_type,
           s.counter_type,s.increment_by,s.created_at
    FROM usage_counter_staging s
    WHERE s.created_at<NOW()-INTERVAL '5 seconds'
      AND s.counter_type NOT LIKE 'billing:%'
    ORDER BY s.id LIMIT 10000 FOR UPDATE SKIP LOCKED
  ), enriched AS (
    SELECT b.*,
           CASE WHEN k.project_id=b.project_id AND k.organization_id=b.org_id THEN k.environment_id END environment_id,
           CASE WHEN k.project_id=b.project_id AND k.organization_id=b.org_id THEN k.id END valid_api_key_id
    FROM batch b LEFT JOIN project_api_keys k ON k.id=b.api_key_id
  ), project_aggregated AS (
    SELECT org_id,project_id,environment_id,valid_api_key_id,date_trunc('minute',created_at) bucket,
      COALESCE(SUM(increment_by) FILTER(WHERE counter_type IN ('events','accepted_events','accepted_event_count')),0)::BIGINT total_events,
      COALESCE(SUM(increment_by) FILTER(WHERE counter_type IN ('errors','error_events','error_event_count')),0)::BIGINT errors,
      COALESCE(SUM(increment_by) FILTER(WHERE counter_type IN ('requests','request_count')),0)::BIGINT requests,
      COALESCE(SUM(increment_by) FILTER(WHERE counter_type IN ('bytes_ingested','accepted_bytes')),0)::BIGINT total_bytes,
      COALESCE(SUM(increment_by) FILTER(WHERE counter_type IN ('rate_limited','rate_limited_requests','rate_limited_request_count')),0)::NUMERIC rate_limit_usage
    FROM enriched
    GROUP BY org_id,project_id,environment_id,valid_api_key_id,date_trunc('minute',created_at)
  ), project_upsert AS (
    INSERT INTO project_usage_minute(
      organization_id,project_id,environment_id,api_key_id,bucket,
      total_events,errors,requests,total_bytes,rate_limit_usage
    )
    SELECT org_id,project_id,environment_id,valid_api_key_id,bucket,
           total_events,errors,requests,total_bytes,rate_limit_usage
    FROM project_aggregated
    ON CONFLICT(organization_id,project_id,environment_id,api_key_id,bucket) DO UPDATE SET
      total_events=project_usage_minute.total_events+EXCLUDED.total_events,
      errors=project_usage_minute.errors+EXCLUDED.errors,
      requests=project_usage_minute.requests+EXCLUDED.requests,
      total_bytes=project_usage_minute.total_bytes+EXCLUDED.total_bytes,
      rate_limit_usage=project_usage_minute.rate_limit_usage+EXCLUDED.rate_limit_usage,
      updated_at=NOW()
    RETURNING project_id
  ), key_aggregated AS (
    SELECT e.valid_api_key_id api_key_id,e.project_id,e.org_id organization_id,e.environment_id,
           date_trunc('minute',e.created_at) bucket,t.id event_type_id,
      COALESCE(SUM(e.increment_by) FILTER(WHERE e.counter_type IN ('requests','request_count')),0)::BIGINT request_count,
      COALESCE(SUM(e.increment_by) FILTER(WHERE e.counter_type IN ('events','accepted_events','accepted_event_count')),0)::BIGINT accepted_event_count,
      COALESCE(SUM(e.increment_by) FILTER(WHERE e.counter_type IN ('errors','error_events','error_event_count')),0)::BIGINT error_event_count,
      COALESCE(SUM(e.increment_by) FILTER(WHERE e.counter_type IN ('ingestion_failures','ingestion_failure','ingestion_failure_count')),0)::BIGINT ingestion_failure_count,
      COALESCE(SUM(e.increment_by) FILTER(WHERE e.counter_type IN ('bytes_ingested','accepted_bytes')),0)::BIGINT accepted_bytes,
      COALESCE(SUM(e.increment_by) FILTER(WHERE e.counter_type IN ('rate_limited','rate_limited_requests','rate_limited_request_count')),0)::BIGINT rate_limited_request_count
    FROM enriched e JOIN telemetry_event_types t
      ON t.name=COALESCE(NULLIF(btrim(e.event_type),''),'all')
    WHERE e.valid_api_key_id IS NOT NULL AND e.environment_id IS NOT NULL
    GROUP BY e.valid_api_key_id,e.project_id,e.org_id,e.environment_id,
             date_trunc('minute',e.created_at),t.id
  ), key_upsert AS (
    INSERT INTO api_key_usage_minute(
      api_key_id,project_id,organization_id,environment_id,bucket,event_type_id,
      request_count,accepted_event_count,error_event_count,ingestion_failure_count,
      accepted_bytes,rate_limited_request_count
    )
    SELECT api_key_id,project_id,organization_id,environment_id,bucket,event_type_id,
      request_count,accepted_event_count,error_event_count,ingestion_failure_count,
      accepted_bytes,rate_limited_request_count
    FROM key_aggregated
    ON CONFLICT(api_key_id,bucket,event_type_id) DO UPDATE SET
      request_count=api_key_usage_minute.request_count+EXCLUDED.request_count,
      accepted_event_count=api_key_usage_minute.accepted_event_count+EXCLUDED.accepted_event_count,
      error_event_count=api_key_usage_minute.error_event_count+EXCLUDED.error_event_count,
      ingestion_failure_count=api_key_usage_minute.ingestion_failure_count+EXCLUDED.ingestion_failure_count,
      accepted_bytes=api_key_usage_minute.accepted_bytes+EXCLUDED.accepted_bytes,
      rate_limited_request_count=api_key_usage_minute.rate_limited_request_count+EXCLUDED.rate_limited_request_count,
      updated_at=NOW()
    RETURNING project_id
  ), deleted AS (
    DELETE FROM usage_counter_staging s USING batch b WHERE s.id=b.id RETURNING s.project_id
  )
  SELECT deleted.project_id,COUNT(*)::BIGINT FROM deleted GROUP BY deleted.project_id;
END; $$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION rollup_project_usage() RETURNS VOID AS $$
BEGIN
  INSERT INTO project_usage_hourly(
    organization_id,project_id,environment_id,api_key_id,bucket,total_events,errors,requests,
    transactions,traces,spans,logs,metrics,profiles,ai_events,sdk_requests,total_bytes,
    active_api_keys,active_environments,active_users,active_members,alert_count,
    connector_deliveries,failed_notifications,rate_limit_usage
  )
  SELECT organization_id,project_id,environment_id,api_key_id,date_trunc('hour',bucket),
    SUM(total_events),SUM(errors),SUM(requests),SUM(transactions),SUM(traces),SUM(spans),
    SUM(logs),SUM(metrics),SUM(profiles),SUM(ai_events),SUM(sdk_requests),SUM(total_bytes),
    MAX(active_api_keys),MAX(active_environments),MAX(active_users),MAX(active_members),
    SUM(alert_count),SUM(connector_deliveries),SUM(failed_notifications),SUM(rate_limit_usage)
  FROM project_usage_minute
  GROUP BY organization_id,project_id,environment_id,api_key_id,date_trunc('hour',bucket)
  ON CONFLICT(organization_id,project_id,environment_id,api_key_id,bucket) DO UPDATE SET
    total_events=EXCLUDED.total_events,errors=EXCLUDED.errors,requests=EXCLUDED.requests,
    transactions=EXCLUDED.transactions,traces=EXCLUDED.traces,spans=EXCLUDED.spans,
    logs=EXCLUDED.logs,metrics=EXCLUDED.metrics,profiles=EXCLUDED.profiles,
    ai_events=EXCLUDED.ai_events,sdk_requests=EXCLUDED.sdk_requests,total_bytes=EXCLUDED.total_bytes,
    active_api_keys=EXCLUDED.active_api_keys,active_environments=EXCLUDED.active_environments,
    active_users=EXCLUDED.active_users,active_members=EXCLUDED.active_members,
    alert_count=EXCLUDED.alert_count,connector_deliveries=EXCLUDED.connector_deliveries,
    failed_notifications=EXCLUDED.failed_notifications,rate_limit_usage=EXCLUDED.rate_limit_usage,
    updated_at=NOW(),version=project_usage_hourly.version+1;

  INSERT INTO project_usage_daily(
    organization_id,project_id,environment_id,api_key_id,bucket,total_events,errors,requests,
    transactions,traces,spans,logs,metrics,profiles,ai_events,sdk_requests,total_bytes,
    active_api_keys,active_environments,active_users,active_members,alert_count,
    connector_deliveries,failed_notifications,rate_limit_usage
  )
  SELECT organization_id,project_id,environment_id,api_key_id,date_trunc('day',bucket),
    SUM(total_events),SUM(errors),SUM(requests),SUM(transactions),SUM(traces),SUM(spans),
    SUM(logs),SUM(metrics),SUM(profiles),SUM(ai_events),SUM(sdk_requests),SUM(total_bytes),
    MAX(active_api_keys),MAX(active_environments),MAX(active_users),MAX(active_members),
    SUM(alert_count),SUM(connector_deliveries),SUM(failed_notifications),SUM(rate_limit_usage)
  FROM project_usage_hourly
  GROUP BY organization_id,project_id,environment_id,api_key_id,date_trunc('day',bucket)
  ON CONFLICT(organization_id,project_id,environment_id,api_key_id,bucket) DO UPDATE SET
    total_events=EXCLUDED.total_events,errors=EXCLUDED.errors,requests=EXCLUDED.requests,
    transactions=EXCLUDED.transactions,traces=EXCLUDED.traces,spans=EXCLUDED.spans,
    logs=EXCLUDED.logs,metrics=EXCLUDED.metrics,profiles=EXCLUDED.profiles,
    ai_events=EXCLUDED.ai_events,sdk_requests=EXCLUDED.sdk_requests,total_bytes=EXCLUDED.total_bytes,
    active_api_keys=EXCLUDED.active_api_keys,active_environments=EXCLUDED.active_environments,
    active_users=EXCLUDED.active_users,active_members=EXCLUDED.active_members,
    alert_count=EXCLUDED.alert_count,connector_deliveries=EXCLUDED.connector_deliveries,
    failed_notifications=EXCLUDED.failed_notifications,rate_limit_usage=EXCLUDED.rate_limit_usage,
    updated_at=NOW(),version=project_usage_daily.version+1;

  INSERT INTO project_usage_monthly(
    organization_id,project_id,bucket,total_events,total_bytes,api_key_requests,
    rate_limited_events,alert_notifications,active_users
  )
  SELECT organization_id,project_id,date_trunc('month',bucket)::date,SUM(total_events),SUM(total_bytes),
    SUM(requests),SUM(rate_limit_usage)::BIGINT,SUM(alert_count),MAX(active_users)
  FROM project_usage_daily
  GROUP BY organization_id,project_id,date_trunc('month',bucket)::date
  ON CONFLICT(project_id,bucket) DO UPDATE SET
    organization_id=EXCLUDED.organization_id,total_events=EXCLUDED.total_events,
    total_bytes=EXCLUDED.total_bytes,api_key_requests=EXCLUDED.api_key_requests,
    rate_limited_events=EXCLUDED.rate_limited_events,alert_notifications=EXCLUDED.alert_notifications,
    active_users=EXCLUDED.active_users,updated_at=NOW(),version=project_usage_monthly.version+1;

  INSERT INTO project_usage_current(
    project_id,organization_id,period_start,total_events,errors,requests,traces,logs,metrics,
    profiles,alert_count,connector_deliveries,failed_notifications
  )
  SELECT project_id,organization_id,date_trunc('month',CURRENT_DATE)::date,SUM(total_events),
    SUM(errors),SUM(requests),SUM(traces),SUM(logs),SUM(metrics),SUM(profiles),SUM(alert_count),
    SUM(connector_deliveries),SUM(failed_notifications)
  FROM project_usage_daily WHERE bucket>=date_trunc('month',CURRENT_DATE)
  GROUP BY project_id,organization_id
  ON CONFLICT(project_id) DO UPDATE SET
    organization_id=EXCLUDED.organization_id,period_start=EXCLUDED.period_start,
    total_events=EXCLUDED.total_events,errors=EXCLUDED.errors,requests=EXCLUDED.requests,
    traces=EXCLUDED.traces,logs=EXCLUDED.logs,metrics=EXCLUDED.metrics,profiles=EXCLUDED.profiles,
    alert_count=EXCLUDED.alert_count,connector_deliveries=EXCLUDED.connector_deliveries,
    failed_notifications=EXCLUDED.failed_notifications,updated_at=NOW(),
    version=project_usage_current.version+1;
  -- API-key daily is the only persisted rollup. Hourly and monthly are views.
  INSERT INTO api_key_usage_daily(
    api_key_id,project_id,organization_id,environment_id,bucket,event_type_id,
    request_count,accepted_event_count,error_event_count,ingestion_failure_count,
    accepted_bytes,rate_limited_request_count
  )
  SELECT api_key_id,project_id,organization_id,environment_id,bucket::date,event_type_id,
    SUM(request_count),SUM(accepted_event_count),SUM(error_event_count),
    SUM(ingestion_failure_count),SUM(accepted_bytes),SUM(rate_limited_request_count)
  FROM api_key_usage_minute
  GROUP BY api_key_id,project_id,organization_id,environment_id,bucket::date,event_type_id
  ON CONFLICT(api_key_id,bucket,event_type_id) DO UPDATE SET
    project_id=EXCLUDED.project_id,organization_id=EXCLUDED.organization_id,
    environment_id=EXCLUDED.environment_id,request_count=EXCLUDED.request_count,
    accepted_event_count=EXCLUDED.accepted_event_count,error_event_count=EXCLUDED.error_event_count,
    ingestion_failure_count=EXCLUDED.ingestion_failure_count,accepted_bytes=EXCLUDED.accepted_bytes,
    rate_limited_request_count=EXCLUDED.rate_limited_request_count,updated_at=NOW();
END; $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION flush_usage_counters() IS
  'Claims staging rows concurrently and performs additive, conflict-safe minute UPSERTs for project and API-key facts.';
COMMENT ON FUNCTION rollup_project_usage() IS
  'Rebuilds project hour/day/month/current facts without latency percentiles and rebuilds only persisted API-key daily facts.';

COMMIT;

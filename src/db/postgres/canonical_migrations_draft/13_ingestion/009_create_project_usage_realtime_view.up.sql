BEGIN;

DROP VIEW IF EXISTS project_usage_realtime;
CREATE VIEW project_usage_realtime AS
WITH persisted AS (
  SELECT organization_id,project_id,bucket,
    SUM(total_events) total_events,SUM(errors) errors,SUM(requests) requests,
    SUM(total_bytes) total_bytes,SUM(rate_limit_usage) rate_limit_usage,
    MAX(updated_at) updated_at
  FROM project_usage_minute
  GROUP BY organization_id,project_id,bucket
), staged AS (
  SELECT org_id organization_id,project_id,date_trunc('minute',created_at) bucket,
    COALESCE(SUM(increment_by) FILTER(WHERE counter_type='events'),0)::BIGINT unflushed_events,
    COALESCE(SUM(increment_by) FILTER(WHERE counter_type='errors'),0)::BIGINT unflushed_errors,
    COALESCE(SUM(increment_by) FILTER(WHERE counter_type='requests'),0)::BIGINT unflushed_requests,
    COALESCE(SUM(increment_by) FILTER(WHERE counter_type='bytes_ingested'),0)::BIGINT unflushed_bytes,
    COALESCE(SUM(increment_by) FILTER(WHERE counter_type='rate_limited'),0)::NUMERIC unflushed_rate_limited
  FROM usage_counter_staging
  WHERE counter_type NOT LIKE 'billing:%'
  GROUP BY org_id,project_id,date_trunc('minute',created_at)
)
SELECT COALESCE(p.organization_id,s.organization_id) organization_id,
  COALESCE(p.project_id,s.project_id) project_id,
  COALESCE(p.bucket,s.bucket) bucket,
  COALESCE(p.total_events,0)+COALESCE(s.unflushed_events,0) total_events,
  COALESCE(p.errors,0)+COALESCE(s.unflushed_errors,0) errors,
  COALESCE(p.requests,0)+COALESCE(s.unflushed_requests,0) requests,
  COALESCE(p.total_bytes,0)+COALESCE(s.unflushed_bytes,0) total_bytes,
  COALESCE(p.rate_limit_usage,0)+COALESCE(s.unflushed_rate_limited,0) rate_limit_usage,
  p.updated_at last_flushed_at,NOW() queried_at
FROM persisted p FULL JOIN staged s USING(organization_id,project_id,bucket);

COMMENT ON COLUMN usage_counter_staging.api_key_id IS 'Optional canonical project API-key dimension resolved to environment during rollup.';
COMMENT ON COLUMN usage_counter_staging.event_type IS 'Explicit signal dimension; event type is never encoded into a counter column name.';
COMMENT ON VIEW project_usage_realtime IS 'Canonical project metrics plus unflushed non-billing staging rows.';

COMMIT;

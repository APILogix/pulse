BEGIN;

CREATE OR REPLACE VIEW project_usage_realtime AS
SELECT
  COALESCE(p.project_id, s.project_id) AS project_id,
  COALESCE(p.org_id, s.org_id) AS org_id,
  COALESCE(p.counter_type, s.counter_type) AS counter_type,
  COALESCE(p.value, 0) + COALESCE(s.unflushed_value, 0) AS total_value,
  p.period_start,
  p.period_end,
  p.updated_at AS last_flushed_at,
  NOW() AS queried_at
FROM project_usage p
FULL OUTER JOIN (
  SELECT
    project_id,
    org_id,
    counter_type,
    date_trunc('hour', created_at) AS period_start,
    SUM(increment_by) AS unflushed_value
  FROM usage_counter_staging
  GROUP BY project_id, org_id, counter_type, date_trunc('hour', created_at)
) s
  ON p.project_id = s.project_id
 AND p.counter_type = s.counter_type
 AND p.period_start = s.period_start;

COMMIT;

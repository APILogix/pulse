BEGIN;

CREATE OR REPLACE FUNCTION flush_usage_counters()
RETURNS TABLE(flushed_project_id UUID, flushed_count BIGINT) AS $$
BEGIN
  RETURN QUERY
  WITH batch AS (
    SELECT id, project_id, org_id, counter_type, increment_by, created_at
    FROM usage_counter_staging
    WHERE created_at < NOW() - INTERVAL '5 seconds'
    ORDER BY id
    LIMIT 10000
    FOR UPDATE SKIP LOCKED
  ),
  aggregated AS (
    SELECT
      project_id,
      org_id,
      counter_type,
      date_trunc('hour', created_at) AS period_start,
      date_trunc('hour', created_at) + INTERVAL '1 hour' AS period_end,
      SUM(increment_by) AS total_increment
    FROM batch
    GROUP BY project_id, org_id, counter_type, date_trunc('hour', created_at)
  ),
  upserted AS (
    INSERT INTO project_usage
      (project_id, org_id, counter_type, period_start, period_end, value, updated_at)
    SELECT project_id, org_id, counter_type, period_start, period_end, total_increment, NOW()
    FROM aggregated
    ON CONFLICT (project_id, counter_type, period_start)
    DO UPDATE SET value = project_usage.value + EXCLUDED.value, updated_at = NOW()
    RETURNING project_id
  ),
  deleted AS (
    DELETE FROM usage_counter_staging s
    USING batch b
    WHERE s.id = b.id
    RETURNING s.id, s.project_id
  )
  SELECT d.project_id, COUNT(*)::BIGINT
  FROM deleted d
  GROUP BY d.project_id;
END;
$$ LANGUAGE plpgsql;

COMMIT;

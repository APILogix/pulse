BEGIN;

DROP VIEW IF EXISTS ingestion_queue_snapshot;

CREATE OR REPLACE VIEW ingestion_queue_snapshot AS
SELECT
  queue,
  job_type,
  state,
  priority_label,
  COUNT(*)::bigint AS job_count,
  COUNT(*) FILTER (WHERE attempts > 0)::bigint AS retried_count,
  COALESCE(MIN(EXTRACT(EPOCH FROM (NOW() - created_at)))::int, 0) AS oldest_age_seconds,
  COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - created_at)))::int, 0) AS newest_age_seconds,
  COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - created_at)))::int, 0) AS avg_age_seconds
FROM ingestion_jobs
GROUP BY queue, job_type, state, priority_label;

COMMIT;

-- Canonical billing org/day usage rollup.
-- Source of truth: project_usage (migrations2/010), not legacy organization_usage.
-- Prefer events_accepted when present because billing should count accepted
-- events; ai_analyses is reserved for AI feature metering.

INSERT INTO usage_daily_counters (
  org_id,
  project_id,
  date,
  events_count,
  ai_analyses_count,
  updated_at
)
SELECT
  pu.org_id,
  pu.project_id,
  pu.period_start::date AS date,
  COALESCE(SUM(pu.value) FILTER (WHERE pu.counter_type = 'events_accepted'), 0)::bigint AS events_count,
  COALESCE(SUM(pu.value) FILTER (WHERE pu.counter_type = 'ai_analyses'), 0)::integer AS ai_analyses_count,
  NOW() AS updated_at
FROM project_usage pu
WHERE pu.period_start >= $1::timestamptz
  AND pu.period_start < $2::timestamptz
GROUP BY pu.org_id, pu.project_id, pu.period_start::date
ON CONFLICT (org_id, project_id, date)
DO UPDATE SET
  events_count = EXCLUDED.events_count,
  ai_analyses_count = EXCLUDED.ai_analyses_count,
  updated_at = NOW();

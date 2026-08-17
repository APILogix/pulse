-- Source: migrations/002_create_all.sql
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

-- Source: migrations/002_create_all.sql
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

CREATE OR REPLACE VIEW api_key_usage_hourly AS
SELECT
  api_key_id,
  project_id,
  organization_id,
  environment_id,
  date_trunc('hour', bucket) AS bucket,
  event_type_id,
  SUM(request_count)::bigint AS request_count,
  SUM(accepted_event_count)::bigint AS accepted_event_count,
  SUM(error_event_count)::bigint AS error_event_count,
  SUM(ingestion_failure_count)::bigint AS ingestion_failure_count,
  SUM(accepted_bytes)::bigint AS accepted_bytes,
  SUM(rate_limited_request_count)::bigint AS rate_limited_request_count
FROM api_key_usage_minute
GROUP BY api_key_id, project_id, organization_id, environment_id, date_trunc('hour', bucket), event_type_id;

CREATE OR REPLACE VIEW api_key_usage_monthly AS
SELECT
  api_key_id,
  project_id,
  organization_id,
  environment_id,
  date_trunc('month', bucket) AS bucket,
  event_type_id,
  SUM(request_count)::bigint AS request_count,
  SUM(accepted_event_count)::bigint AS accepted_event_count,
  SUM(error_event_count)::bigint AS error_event_count,
  SUM(ingestion_failure_count)::bigint AS ingestion_failure_count,
  SUM(accepted_bytes)::bigint AS accepted_bytes,
  SUM(rate_limited_request_count)::bigint AS rate_limited_request_count
FROM api_key_usage_daily
GROUP BY api_key_id, project_id, organization_id, environment_id, date_trunc('month', bucket), event_type_id;

-- Source: canonical_migrations_draft/19_automation/014_automation_indexes_and_views.sql
CREATE OR REPLACE VIEW v_automation_workflow_summaries AS
SELECT
  w.id,
  w.organization_id,
  w.project_id,
  w.created_by,
  w.updated_by,
  w.template_id,
  w.name,
  w.slug,
  w.description,
  w.workflow_type,
  w.scope,
  w.status,
  w.is_enabled,
  w.current_version,
  w.last_run_at,
  w.next_run_at,
  w.timezone,
  w.tags,
  w.metadata,
  w.created_at,
  w.updated_at,
  w.deleted_at,
  COALESCE(tc.trigger_count, 0) AS trigger_count,
  tc.trigger_type,
  COALESCE(ac.action_count, 0) AS action_count,
  COALESCE(ac.action_types, ARRAY[]::text[]) AS action_types,
  COALESCE(ac.action_requires_approval, ARRAY[]::boolean[]) AS action_requires_approval
FROM automation_workflows w
LEFT JOIN LATERAL (
  SELECT COUNT(*)::int AS trigger_count, MIN(t.trigger_type) AS trigger_type
  FROM automation_triggers t
  WHERE t.workflow_id = w.id
    AND t.workflow_version_id IS NULL
    AND t.deleted_at IS NULL
) tc ON TRUE
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::int AS action_count,
    ARRAY_AGG(a.action_type ORDER BY a.sort_order) AS action_types,
    ARRAY_AGG(a.requires_approval ORDER BY a.sort_order) AS action_requires_approval
  FROM automation_actions a
  WHERE a.workflow_id = w.id
    AND a.workflow_version_id IS NULL
    AND a.deleted_at IS NULL
    AND a.is_enabled = TRUE
) ac ON TRUE
WHERE w.deleted_at IS NULL;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE VIEW v_current_usage AS
SELECT
    organization_id,
    period_start,
    period_end,
    events_used,
    event_limit,
    (event_limit - events_used) AS remaining_events,
    ai_credits_used,
    ai_credit_limit,
    (ai_credit_limit - ai_credits_used) AS remaining_ai_credits,
    projects_used,
    members_used,
    api_keys_used,
    connectors_used,
    alert_rules_used,
    dashboards_used
FROM organization_usage_current_period;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE VIEW v_effective_entitlements AS
SELECT
    os.organization_id,
    bf.feature_key,
    COALESCE(ofo.boolean_value, pfe.boolean_value)     AS boolean_value,
    COALESCE(ofo.integer_value, pfe.integer_value)     AS integer_value,
    COALESCE(ofo.decimal_value, pfe.decimal_value)     AS decimal_value,
    COALESCE(ofo.string_value, pfe.string_value)       AS string_value
FROM organization_subscriptions os
JOIN plans p
  ON p.id = os.plan_id
JOIN plan_feature_entitlements pfe
  ON pfe.plan_id = p.id
JOIN billing_features bf
  ON bf.id = pfe.feature_id
LEFT JOIN organization_feature_overrides ofo
  ON ofo.organization_id = os.organization_id
 AND ofo.feature_id = bf.id
 AND ofo.deleted_at IS NULL
 AND (ofo.expires_at IS NULL OR ofo.expires_at > NOW())
WHERE os.status IN ('trialing','active','past_due');

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE VIEW v_subscription_summary AS
SELECT
    os.organization_id,
    p.name            AS plan_name,
    p.key             AS plan_key,
    p.tier,
    os.status,
    os.billing_interval,
    os.current_period_start,
    os.current_period_end,
    os.cancel_at_period_end
FROM organization_subscriptions os
JOIN plans p
  ON p.id = os.plan_id;

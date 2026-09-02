BEGIN;

-- Speed up org-wide observability explorer and detail read paths.
--
-- Existing tenant indexes mostly start with (organization_id, project_id,
-- occurred_at). That is good for a single project, but org-level explorer
-- requests pass project_id = ANY(...) and order/aggregate by occurred_at
-- across projects. These indexes let PostgreSQL scan the tenant/time window
-- directly, then apply project visibility as a residual filter.

CREATE INDEX IF NOT EXISTS idx_events_requests_org_time
  ON events_requests (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_requests_org_env_time
  ON events_requests (organization_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_requests_org_trace_time
  ON events_requests (organization_id, trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_requests_org_request_time
  ON events_requests (organization_id, request_id, occurred_at DESC)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_errors_org_time
  ON events_errors (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_errors_org_env_direct_time
  ON events_errors (organization_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_logs_org_time
  ON events_logs (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_logs_org_env_time
  ON events_logs (organization_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_logs_org_trace_time
  ON events_logs (organization_id, trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_logs_org_request_time
  ON events_logs (organization_id, request_id, occurred_at DESC)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_metrics_org_time
  ON events_metrics (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_metrics_org_env_time
  ON events_metrics (organization_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_spans_org_time
  ON events_spans (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_spans_org_env_time
  ON events_spans (organization_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_spans_org_trace_time
  ON events_spans (organization_id, trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_org_request_time
  ON events_spans (organization_id, request_id, occurred_at DESC)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_traces_org_time
  ON events_traces (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_traces_org_env_time
  ON events_traces (organization_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_traces_org_trace_time
  ON events_traces (organization_id, trace_id, occurred_at DESC)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_profiles_org_time
  ON events_profiles (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_profiles_org_env_time
  ON events_profiles (organization_id, environment, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_org_time
  ON events_cron_checkins (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_cron_checkins_org_env_time
  ON events_cron_checkins (organization_id, environment, occurred_at DESC);

COMMIT;

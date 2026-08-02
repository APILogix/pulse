-- ============================================================
-- 010_normalize_metrics_enterprise.sql
-- Enterprise-grade normalization for events_metrics.
-- Safe to run multiple times (all ADD COLUMN IF NOT EXISTS).
-- ============================================================
BEGIN;

-- ── 1. Add all missing canonical columns ──────────────────────────────────────
ALTER TABLE events_metrics
  ADD COLUMN IF NOT EXISTS metric_unit        TEXT,
  ADD COLUMN IF NOT EXISTS metric_namespace   TEXT,
  ADD COLUMN IF NOT EXISTS metric_description TEXT,
  ADD COLUMN IF NOT EXISTS metric_category    TEXT,
  ADD COLUMN IF NOT EXISTS aggregation_type   TEXT,
  ADD COLUMN IF NOT EXISTS temporality        TEXT,
  ADD COLUMN IF NOT EXISTS is_monotonic       BOOLEAN,
  ADD COLUMN IF NOT EXISTS tenant_id          TEXT,
  ADD COLUMN IF NOT EXISTS http_method        TEXT;

-- ── 2. Backfill all existing rows from payload / tags / existing columns ────────
UPDATE events_metrics
SET
  -- Metric identity
  metric_name        = COALESCE(metric_name,   payload->>'metricName', payload->>'name'),
  metric_type        = COALESCE(metric_type,   payload->>'metricType'),
  metric_unit        = COALESCE(metric_unit,   payload->>'metricUnit', payload->>'unit', unit),
  unit               = COALESCE(unit,          metric_unit, payload->>'metricUnit', payload->>'unit'),
  metric_namespace   = COALESCE(metric_namespace,   payload->>'metricNamespace', tags->>'namespace'),
  metric_description = COALESCE(metric_description, payload->>'metricDescription'),

  -- Numeric aggregates (from payload if missing)
  value = COALESCE(value, NULLIF(payload->>'value',  '')::double precision),
  count = COALESCE(count, NULLIF(payload->>'count',  '')::double precision),
  sum   = COALESCE(sum,   NULLIF(payload->>'sum',    '')::double precision),
  min   = COALESCE(min,   NULLIF(payload->>'min',    '')::double precision),
  max   = COALESCE(max,   NULLIF(payload->>'max',    '')::double precision),
  avg   = COALESCE(avg,   NULLIF(payload->>'avg',    '')::double precision),
  rate  = COALESCE(rate,  NULLIF(payload->>'rate',   '')::double precision),
  p50   = COALESCE(p50,   NULLIF(payload->>'p50',    '')::double precision),
  p75   = COALESCE(p75,   NULLIF(payload->>'p75',    '')::double precision),
  p90   = COALESCE(p90,   NULLIF(payload->>'p90',    '')::double precision),
  p95   = COALESCE(p95,   NULLIF(payload->>'p95',    '')::double precision),
  p99   = COALESCE(p99,   NULLIF(payload->>'p99',    '')::double precision),

  -- Context IDs
  event_id   = COALESCE(event_id,   payload->>'eventId'),
  request_id = COALESCE(request_id, payload->>'requestId'),
  session_id = COALESCE(session_id, payload->>'sessionId'),
  trace_id   = COALESCE(trace_id,   payload->>'traceId'),
  span_id    = COALESCE(span_id,    payload->>'spanId'),
  tenant_id  = COALESCE(tenant_id,  payload->>'tenantId'),
  user_id    = COALESCE(user_id,    payload->>'userId'),

  -- HTTP context (promoted from tags)
  endpoint    = COALESCE(endpoint,    tags->>'path', tags->>'route', tags->>'endpoint', tags->>'http.route'),
  http_method = COALESCE(http_method, tags->>'method', tags->>'http.method', tags->>'http_method'),
  status_code = COALESCE(status_code, NULLIF(COALESCE(tags->>'status', tags->>'statusCode', tags->>'status_code', tags->>'http.status_code'), '')::integer),

  -- Timestamps
  occurred_at = COALESCE(occurred_at, timestamp),
  timestamp   = COALESCE(timestamp,   occurred_at),

  -- SDK metadata (from payload.metadata)
  project_id          = COALESCE(project_id, NULLIF(payload #>> '{metadata,projectId}', '')::uuid),
  environment         = COALESCE(environment, payload #>> '{metadata,environment}'),
  sdk_name            = COALESCE(sdk_name,    payload #>> '{metadata,sdkName}'),
  sdk_version         = COALESCE(sdk_version, payload #>> '{metadata,sdkVersion}'),
  application_name    = COALESCE(application_name,    payload #>> '{metadata,applicationName}'),
  application_version = COALESCE(application_version, payload #>> '{metadata,applicationVersion}'),
  release             = COALESCE(release,     payload #>> '{metadata,release}'),
  server_name         = COALESCE(server_name, payload #>> '{metadata,serverName}'),

  -- OTel classification
  temporality   = COALESCE(temporality,   payload->>'temporality'),
  is_monotonic  = COALESCE(is_monotonic,  NULLIF(payload->>'isMonotonic', '')::boolean),
  aggregation_type = COALESCE(aggregation_type, payload->>'aggregationType', payload->>'metricType'),

  -- Tags (normalize from payload if empty)
  tags = COALESCE(
    NULLIF(tags, 'null'::jsonb),
    CASE WHEN jsonb_typeof(payload->'tags') = 'object' THEN payload->'tags' ELSE '{}'::jsonb END,
    '{}'::jsonb
  )
WHERE TRUE;

-- ── 3. Classify metric_category from names, types, tags ──────────────────────
UPDATE events_metrics
SET metric_category = CASE
  WHEN endpoint IS NOT NULL OR http_method IS NOT NULL
    OR metric_name LIKE 'http.%' OR metric_name ILIKE '%http%'   THEN 'http'
  WHEN metric_name LIKE 'db.%' OR metric_name ILIKE '%database%'
    OR tags ? 'db.system'                                         THEN 'database'
  WHEN metric_name ILIKE '%redis%' OR metric_name ILIKE '%cache%'
    OR metric_name ILIKE '%memcache%'                             THEN 'cache'
  WHEN metric_name ILIKE '%queue%' OR tags ? 'messaging.system'  THEN 'queue'
  WHEN metric_name LIKE 'runtime.%'                              THEN 'runtime'
  WHEN metric_name LIKE 'system.%'                               THEN 'system'
  WHEN metric_name ILIKE '%network%' OR metric_name LIKE 'net.%' THEN 'network'
  WHEN metric_name ILIKE '%memory%' OR metric_name ILIKE '%heap%'
    OR metric_name ILIKE '%rss%'                                  THEN 'memory'
  WHEN metric_name ILIKE '%cpu%'                                 THEN 'cpu'
  WHEN metric_name ILIKE '%disk%' OR metric_name LIKE 'fs.%'    THEN 'disk'
  WHEN metric_name LIKE 'business.%'                            THEN 'business'
  WHEN metric_name LIKE 'app.%' OR metric_name LIKE 'application.%' THEN 'application'
  ELSE 'custom'
END
WHERE metric_category IS NULL;

-- ── 4. Clean attributes: remove all fields that have a dedicated column ────────
UPDATE events_metrics
SET attributes = COALESCE(attributes, '{}'::jsonb)
  - 'metricName' - 'metric_name' - 'metricType' - 'metric_type'
  - 'metricUnit' - 'metric_unit' - 'unit'
  - 'metricNamespace' - 'metric_namespace'
  - 'metricDescription' - 'metric_description'
  - 'value' - 'count' - 'sum' - 'min' - 'max' - 'avg'
  - 'rate' - 'p50' - 'p75' - 'p90' - 'p95' - 'p99'
  - 'aggregationType' - 'aggregation_type'
  - 'temporality' - 'isMonotonic' - 'is_monotonic'
  - 'endpoint' - 'path' - 'route'
  - 'method' - 'httpMethod' - 'http_method'
  - 'status' - 'statusCode' - 'status_code'
  - 'requestId' - 'request_id' - 'sessionId' - 'session_id'
  - 'traceId' - 'trace_id' - 'spanId' - 'span_id'
  - 'tenantId' - 'tenant_id'
  - 'projectId' - 'project_id'
  - 'organizationId' - 'organization_id'
  - 'environment'
  - 'applicationName' - 'application_name'
  - 'applicationVersion' - 'application_version'
  - 'sdkName' - 'sdk_name' - 'sdkVersion' - 'sdk_version'
  - 'release' - 'timestamp' - 'eventId' - 'event_id'
  - 'userId' - 'user_id';

-- ── 5. CHECK constraints for controlled-vocabulary columns ─────────────────────
ALTER TABLE events_metrics
  DROP CONSTRAINT IF EXISTS events_metrics_metric_category_ck,
  ADD CONSTRAINT events_metrics_metric_category_ck
    CHECK (metric_category IS NULL OR metric_category IN (
      'http','database','cache','queue','runtime','system','business','application',
      'network','memory','cpu','disk','custom'
    )),
  DROP CONSTRAINT IF EXISTS events_metrics_aggregation_type_ck,
  ADD CONSTRAINT events_metrics_aggregation_type_ck
    CHECK (aggregation_type IS NULL OR aggregation_type IN (
      'counter','gauge','histogram','summary',
      'observable_counter','observable_gauge','up_down_counter'
    )),
  DROP CONSTRAINT IF EXISTS events_metrics_temporality_ck,
  ADD CONSTRAINT events_metrics_temporality_ck
    CHECK (temporality IS NULL OR temporality IN ('delta','cumulative','unspecified'));

-- ── 6. Indexes — only create what doesn't already exist ───────────────────────

-- Already exists: idx_events_metrics_name_time (org, project, metric_name, timestamp)
-- Already exists: idx_events_metrics_request_time (org, project, request_id, timestamp)
-- Already exists: idx_events_metrics_tenant_env_time (org, project, environment, occurred_at)
-- Already exists: idx_events_metrics_tenant_time (org, project, occurred_at)
-- Already exists: idx_events_metrics_service (service, occurred_at)
-- Already exists: idx_events_metrics_trace (trace_id, occurred_at)

-- NEW: optimized time-series queries per metric_name
CREATE INDEX IF NOT EXISTS idx_events_metrics_project_metric_time
  ON events_metrics(project_id, metric_name, occurred_at DESC);

-- NEW: environment + time range queries
CREATE INDEX IF NOT EXISTS idx_events_metrics_project_env_time
  ON events_metrics(project_id, environment, occurred_at DESC);

-- NEW: metric_name only (cross-project dashboards, admin views)
CREATE INDEX IF NOT EXISTS idx_events_metrics_name_occurred
  ON events_metrics(metric_name, occurred_at DESC);

-- NEW: endpoint breakdown (HTTP metric dashboards)
CREATE INDEX IF NOT EXISTS idx_events_metrics_endpoint_time
  ON events_metrics(organization_id, project_id, endpoint, occurred_at DESC)
  WHERE endpoint IS NOT NULL;

-- NEW: HTTP method breakdown
CREATE INDEX IF NOT EXISTS idx_events_metrics_http_method_time
  ON events_metrics(organization_id, project_id, http_method, occurred_at DESC)
  WHERE http_method IS NOT NULL;

-- NEW: tenant isolation (multi-tenant SaaS metrics)
CREATE INDEX IF NOT EXISTS idx_events_metrics_tenant_id_time
  ON events_metrics(organization_id, project_id, tenant_id, occurred_at DESC)
  WHERE tenant_id IS NOT NULL;

-- NEW: metric category dashboards
CREATE INDEX IF NOT EXISTS idx_events_metrics_category_time
  ON events_metrics(organization_id, project_id, metric_category, occurred_at DESC)
  WHERE metric_category IS NOT NULL;

-- NEW: metric_type for counter/gauge/histogram routing
CREATE INDEX IF NOT EXISTS idx_events_metrics_metric_type_time
  ON events_metrics(organization_id, project_id, metric_type, occurred_at DESC);

COMMIT;

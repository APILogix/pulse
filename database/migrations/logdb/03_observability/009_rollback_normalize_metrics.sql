BEGIN;

DROP INDEX IF EXISTS idx_events_metrics_category_time;
DROP INDEX IF EXISTS idx_events_metrics_tenant_time;
DROP INDEX IF EXISTS idx_events_metrics_http_method_time;
DROP INDEX IF EXISTS idx_events_metrics_endpoint_time;
DROP INDEX IF EXISTS idx_events_metrics_name_occurred;
DROP INDEX IF EXISTS idx_events_metrics_project_env_time;
DROP INDEX IF EXISTS idx_events_metrics_project_metric_time;
DROP INDEX IF EXISTS idx_events_metrics_metric_type_time;

ALTER TABLE events_metrics
  DROP CONSTRAINT IF EXISTS events_metrics_temporality_ck,
  DROP CONSTRAINT IF EXISTS events_metrics_aggregation_type_ck,
  DROP CONSTRAINT IF EXISTS events_metrics_metric_category_ck;

ALTER TABLE events_metrics
  DROP COLUMN IF EXISTS metric_unit,
  DROP COLUMN IF EXISTS metric_namespace,
  DROP COLUMN IF EXISTS metric_description,
  DROP COLUMN IF EXISTS metric_category,
  DROP COLUMN IF EXISTS aggregation_type,
  DROP COLUMN IF EXISTS temporality,
  DROP COLUMN IF EXISTS is_monotonic,
  DROP COLUMN IF EXISTS tenant_id,
  DROP COLUMN IF EXISTS http_method;

COMMIT;

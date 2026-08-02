-- ============================================================
-- 010_rollback_normalize_metrics_enterprise.sql
-- Safely removes only the schema objects added in 010_normalize_metrics_enterprise.sql
-- Does NOT drop payload or metadata.
-- ============================================================
BEGIN;

-- Drop new indexes (the ones added in 010)
DROP INDEX IF EXISTS idx_events_metrics_project_metric_time;
DROP INDEX IF EXISTS idx_events_metrics_project_env_time;
DROP INDEX IF EXISTS idx_events_metrics_name_occurred;
DROP INDEX IF EXISTS idx_events_metrics_endpoint_time;
DROP INDEX IF EXISTS idx_events_metrics_http_method_time;
DROP INDEX IF EXISTS idx_events_metrics_tenant_id_time;
DROP INDEX IF EXISTS idx_events_metrics_category_time;
DROP INDEX IF EXISTS idx_events_metrics_metric_type_time;

-- Drop CHECK constraints
ALTER TABLE events_metrics
  DROP CONSTRAINT IF EXISTS events_metrics_metric_category_ck,
  DROP CONSTRAINT IF EXISTS events_metrics_aggregation_type_ck,
  DROP CONSTRAINT IF EXISTS events_metrics_temporality_ck;

-- Drop the newly added columns (backfilled data will be lost)
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

-- NOTE: payload, metadata, tags, attributes, and all other original columns are preserved.

COMMIT;

-- Migration: Guarantee project_settings Column Defaults
-- =============================================================================
-- Ensures default values for project_settings columns are set at the schema
-- layer, preventing runtime ALTER TABLE execution on the application request path.
-- =============================================================================

ALTER TABLE project_settings
  ALTER COLUMN data_retention_days SET DEFAULT 10,
  ALTER COLUMN sampling_rate SET DEFAULT 1.00000,
  ALTER COLUMN allowed_domains SET DEFAULT '{}'::text[],
  ALTER COLUMN blocked_domains SET DEFAULT '{}'::text[],
  ALTER COLUMN pii_scrubbing_enabled SET DEFAULT true,
  ALTER COLUMN ip_collection_enabled SET DEFAULT true,
  ALTER COLUMN release_tracking_enabled SET DEFAULT true,
  ALTER COLUMN session_replay_enabled SET DEFAULT false,
  ALTER COLUMN performance_monitoring_enabled SET DEFAULT true,
  ALTER COLUMN error_monitoring_enabled SET DEFAULT true,
  ALTER COLUMN log_ingestion_enabled SET DEFAULT true,
  ALTER COLUMN metric_ingestion_enabled SET DEFAULT true,
  ALTER COLUMN trace_ingestion_enabled SET DEFAULT true,
  ALTER COLUMN profile_ingestion_enabled SET DEFAULT true,
  ALTER COLUMN version SET DEFAULT 1;

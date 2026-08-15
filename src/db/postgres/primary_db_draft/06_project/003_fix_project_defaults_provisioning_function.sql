-- Repair stale project provisioning trigger functions that inserted only
-- project_id and organization_id into project_settings.
--
-- project_settings has NOT NULL defaults; the trigger must provide explicit
-- defaults so older live databases do not fail before application-level
-- provisioning can continue.

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

UPDATE project_settings
SET
  data_retention_days = COALESCE(data_retention_days, 10),
  sampling_rate = COALESCE(sampling_rate, 1.00000),
  allowed_domains = COALESCE(allowed_domains, '{}'::text[]),
  blocked_domains = COALESCE(blocked_domains, '{}'::text[]),
  pii_scrubbing_enabled = COALESCE(pii_scrubbing_enabled, true),
  ip_collection_enabled = COALESCE(ip_collection_enabled, true),
  release_tracking_enabled = COALESCE(release_tracking_enabled, true),
  session_replay_enabled = COALESCE(session_replay_enabled, false),
  performance_monitoring_enabled = COALESCE(performance_monitoring_enabled, true),
  error_monitoring_enabled = COALESCE(error_monitoring_enabled, true),
  log_ingestion_enabled = COALESCE(log_ingestion_enabled, true),
  metric_ingestion_enabled = COALESCE(metric_ingestion_enabled, true),
  trace_ingestion_enabled = COALESCE(trace_ingestion_enabled, true),
  profile_ingestion_enabled = COALESCE(profile_ingestion_enabled, true),
  version = COALESCE(version, 1)
WHERE data_retention_days IS NULL
   OR sampling_rate IS NULL
   OR allowed_domains IS NULL
   OR blocked_domains IS NULL
   OR pii_scrubbing_enabled IS NULL
   OR ip_collection_enabled IS NULL
   OR release_tracking_enabled IS NULL
   OR session_replay_enabled IS NULL
   OR performance_monitoring_enabled IS NULL
   OR error_monitoring_enabled IS NULL
   OR log_ingestion_enabled IS NULL
   OR metric_ingestion_enabled IS NULL
   OR trace_ingestion_enabled IS NULL
   OR profile_ingestion_enabled IS NULL
   OR version IS NULL;

-- Project defaults are provisioned explicitly in application-level transactions
-- (ProjectService.createProject). Clean up any legacy database triggers or functions.
DROP TRIGGER IF EXISTS trg_projects_provision_defaults ON projects;
DROP FUNCTION IF EXISTS provision_project_schema_defaults();


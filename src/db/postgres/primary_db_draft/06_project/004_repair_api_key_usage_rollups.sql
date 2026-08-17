-- Idempotent repair for databases that were created before normalized
-- API-key usage facts and monthly/hourly views existed.

DO $$
DECLARE
  all_event_type_id SMALLINT;
BEGIN
  SELECT id INTO all_event_type_id FROM telemetry_event_types WHERE name = '__all__';

  IF to_regclass('public.api_key_usage_minute') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_key_usage_minute' AND column_name = 'requests'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_key_usage_minute' AND column_name = 'request_count'
    ) THEN
      ALTER TABLE api_key_usage_minute RENAME COLUMN requests TO request_count;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_key_usage_minute' AND column_name = 'events'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_key_usage_minute' AND column_name = 'accepted_event_count'
    ) THEN
      ALTER TABLE api_key_usage_minute RENAME COLUMN events TO accepted_event_count;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_key_usage_minute' AND column_name = 'errors'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_key_usage_minute' AND column_name = 'error_event_count'
    ) THEN
      ALTER TABLE api_key_usage_minute RENAME COLUMN errors TO error_event_count;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_key_usage_minute' AND column_name = 'rate_limited'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_key_usage_minute' AND column_name = 'rate_limited_request_count'
    ) THEN
      ALTER TABLE api_key_usage_minute RENAME COLUMN rate_limited TO rate_limited_request_count;
    END IF;

    ALTER TABLE api_key_usage_minute
      ADD COLUMN IF NOT EXISTS event_type_id SMALLINT,
      ADD COLUMN IF NOT EXISTS request_count BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS accepted_event_count BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS error_event_count BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS ingestion_failure_count BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS accepted_bytes BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS rate_limited_request_count BIGINT NOT NULL DEFAULT 0;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_key_usage_minute' AND column_name = 'bytes_ingested'
    ) THEN
      UPDATE api_key_usage_minute
         SET accepted_bytes = COALESCE(accepted_bytes, bytes_ingested, 0);
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_key_usage_minute' AND column_name = 'event_type'
    ) THEN
      INSERT INTO telemetry_event_types(name)
      SELECT DISTINCT event_type
        FROM api_key_usage_minute
       WHERE event_type IS NOT NULL
      ON CONFLICT (name) DO NOTHING;

      UPDATE api_key_usage_minute m
         SET event_type_id = t.id
        FROM telemetry_event_types t
       WHERE t.name = m.event_type
         AND m.event_type_id IS NULL;
    END IF;

    UPDATE api_key_usage_minute
       SET event_type_id = all_event_type_id
     WHERE event_type_id IS NULL;

    ALTER TABLE api_key_usage_minute
      ALTER COLUMN event_type_id SET NOT NULL,
      ALTER COLUMN request_count SET NOT NULL,
      ALTER COLUMN accepted_event_count SET NOT NULL,
      ALTER COLUMN error_event_count SET NOT NULL,
      ALTER COLUMN ingestion_failure_count SET NOT NULL,
      ALTER COLUMN accepted_bytes SET NOT NULL,
      ALTER COLUMN rate_limited_request_count SET NOT NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS api_key_usage_daily (
  api_key_id UUID NOT NULL REFERENCES project_api_keys(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  environment_id UUID REFERENCES project_environments(id) ON DELETE SET NULL,
  bucket TIMESTAMPTZ NOT NULL,
  event_type_id SMALLINT NOT NULL REFERENCES telemetry_event_types(id),
  request_count BIGINT NOT NULL DEFAULT 0,
  accepted_event_count BIGINT NOT NULL DEFAULT 0,
  error_event_count BIGINT NOT NULL DEFAULT 0,
  ingestion_failure_count BIGINT NOT NULL DEFAULT 0,
  accepted_bytes BIGINT NOT NULL DEFAULT 0,
  rate_limited_request_count BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key_id, bucket, event_type_id)
);

INSERT INTO api_key_usage_daily (
  api_key_id, project_id, organization_id, environment_id, bucket, event_type_id,
  request_count, accepted_event_count, error_event_count, ingestion_failure_count,
  accepted_bytes, rate_limited_request_count
)
SELECT
  api_key_id,
  project_id,
  organization_id,
  environment_id,
  date_trunc('day', bucket),
  event_type_id,
  SUM(request_count)::bigint,
  SUM(accepted_event_count)::bigint,
  SUM(error_event_count)::bigint,
  SUM(ingestion_failure_count)::bigint,
  SUM(accepted_bytes)::bigint,
  SUM(rate_limited_request_count)::bigint
FROM api_key_usage_minute
GROUP BY api_key_id, project_id, organization_id, environment_id, date_trunc('day', bucket), event_type_id
ON CONFLICT (api_key_id, bucket, event_type_id) DO NOTHING;

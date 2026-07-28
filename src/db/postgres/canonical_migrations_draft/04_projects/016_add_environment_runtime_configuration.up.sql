BEGIN;

-- Forward convergence for environment controls already exposed by the runtime.
ALTER TABLE project_environments
  ADD COLUMN IF NOT EXISTS rate_limit_per_second INTEGER,
  ADD COLUMN IF NOT EXISTS rate_limit_per_minute INTEGER,
  ADD COLUMN IF NOT EXISTS rate_limit_per_hour INTEGER,
  ADD COLUMN IF NOT EXISTS burst_limit INTEGER,
  ADD COLUMN IF NOT EXISTS allowed_event_types TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS max_event_size_bytes INTEGER,
  ADD COLUMN IF NOT EXISTS max_batch_size INTEGER,
  ADD COLUMN IF NOT EXISTS require_https BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS ip_allowlist INET[],
  ADD COLUMN IF NOT EXISTS ip_blocklist INET[],
  ADD COLUMN IF NOT EXISTS alert_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS alert_webhook_url VARCHAR(500);

ALTER TABLE project_environments
  DROP CONSTRAINT IF EXISTS project_environments_runtime_limits_check;
ALTER TABLE project_environments
  ADD CONSTRAINT project_environments_runtime_limits_check CHECK (
    (rate_limit_per_second IS NULL OR rate_limit_per_second > 0)
    AND (rate_limit_per_minute IS NULL OR rate_limit_per_minute > 0)
    AND (rate_limit_per_hour IS NULL OR rate_limit_per_hour > 0)
    AND (burst_limit IS NULL OR burst_limit > 0)
    AND (max_event_size_bytes IS NULL OR max_event_size_bytes > 0)
    AND (max_batch_size IS NULL OR max_batch_size > 0)
  );

COMMENT ON COLUMN project_environments.allowed_event_types IS
  'Optional environment-level ingestion allowlist; an empty array allows all event types.';
COMMENT ON COLUMN project_environments.require_https IS
  'Requires HTTPS origins for environment ingestion unless explicitly disabled.';

COMMIT;

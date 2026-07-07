BEGIN;

CREATE TABLE IF NOT EXISTS events_cron_checkins (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  event_id VARCHAR(64) NOT NULL,
  monitor_slug VARCHAR(255) NOT NULL,
  status cron_status NOT NULL,
  duration_ms INTEGER,
  environment VARCHAR(64),
  trace_id VARCHAR(64),
  request_id VARCHAR(64),
  service VARCHAR(100),
  sdk_name VARCHAR(50),
  sdk_version VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_cron_checkins_pkey PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_crons_org_slug
  ON events_cron_checkins(organization_id, monitor_slug, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_crons_brin_time
  ON events_cron_checkins USING BRIN (created_at);

COMMIT;

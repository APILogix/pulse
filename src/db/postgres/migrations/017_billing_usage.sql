BEGIN;

DO $$ BEGIN
  CREATE TYPE usage_granularity AS ENUM ('hourly', 'daily', 'weekly', 'monthly');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS organization_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  metric_type VARCHAR(50) NOT NULL,
  metric_name VARCHAR(255) NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  granularity usage_granularity NOT NULL DEFAULT 'daily',
  usage_count BIGINT NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  usage_limit BIGINT CHECK (usage_limit >= 0),
  overage_count BIGINT NOT NULL DEFAULT 0 CHECK (overage_count >= 0),
  unit_cost NUMERIC(12,6) CHECK (unit_cost >= 0),
  total_cost NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end >= period_start),
  UNIQUE (org_id, metric_type, metric_name, period_start, granularity)
);

DROP TRIGGER IF EXISTS trg_organization_usage_updated_at ON organization_usage;
CREATE TRIGGER trg_organization_usage_updated_at
BEFORE UPDATE ON organization_usage
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_usage_org_period
ON organization_usage(org_id, period_start DESC);

CREATE INDEX IF NOT EXISTS idx_usage_metric
ON organization_usage(metric_type, period_start DESC);

CREATE INDEX IF NOT EXISTS idx_usage_overages
ON organization_usage(org_id, overage_count DESC)
WHERE overage_count > 0;

CREATE TABLE IF NOT EXISTS organization_usage_counters (
  org_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  current_period_start TIMESTAMPTZ NOT NULL,
  api_requests_this_period BIGINT NOT NULL DEFAULT 0 CHECK (api_requests_this_period >= 0),
  metrics_ingested_this_period BIGINT NOT NULL DEFAULT 0 CHECK (metrics_ingested_this_period >= 0),
  storage_gb_this_period NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (storage_gb_this_period >= 0),
  notifications_sent_this_period BIGINT NOT NULL DEFAULT 0 CHECK (notifications_sent_this_period >= 0),
  total_api_requests_all_time BIGINT NOT NULL DEFAULT 0 CHECK (total_api_requests_all_time >= 0),
  total_metrics_ingested_all_time BIGINT NOT NULL DEFAULT 0 CHECK (total_metrics_ingested_all_time >= 0),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  limit_warning_80_sent_at TIMESTAMPTZ,
  limit_warning_100_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_usage_counters_updated_at ON organization_usage_counters;
CREATE TRIGGER trg_usage_counters_updated_at
BEFORE UPDATE ON organization_usage_counters
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_usage_counters_last_updated
ON organization_usage_counters(last_updated_at DESC);

COMMIT;

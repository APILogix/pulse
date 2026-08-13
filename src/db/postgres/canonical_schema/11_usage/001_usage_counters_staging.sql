-- Usage Metering Daily Counters & Staging Schema
-- File: 11_usage/001_usage_counters_staging.sql

CREATE TABLE IF NOT EXISTS usage_daily_counters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  metric_key VARCHAR(128) NOT NULL,
  date_bucket DATE NOT NULL,
  count_value BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_org_proj_metric_date UNIQUE (organization_id, project_id, metric_key, date_bucket)
);

CREATE TABLE IF NOT EXISTS usage_counter_staging (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  metric_key VARCHAR(128) NOT NULL,
  increment_value BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

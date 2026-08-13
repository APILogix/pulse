-- Billing Usage Metering Table Schema
-- File: 07_billing/005_usage_metering_views.sql

CREATE TABLE IF NOT EXISTS organization_usage_current_period (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  events_count BIGINT NOT NULL DEFAULT 0,
  errors_count BIGINT NOT NULL DEFAULT 0,
  logs_bytes BIGINT NOT NULL DEFAULT 0,
  ai_tokens_count BIGINT NOT NULL DEFAULT 0,
  storage_bytes BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

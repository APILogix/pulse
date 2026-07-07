BEGIN;

CREATE TABLE IF NOT EXISTS alert_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
  metric_type VARCHAR(50) NOT NULL,
  value NUMERIC NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  bucket_end TIMESTAMPTZ NOT NULL,
  granularity metric_granularity NOT NULL DEFAULT 'hour',
  labels JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_metric_bucket
  ON alert_metrics(
    organization_id,
    metric_type,
    COALESCE(rule_id, '00000000-0000-0000-0000-000000000000'::uuid),
    bucket_start,
    granularity
  );
CREATE INDEX IF NOT EXISTS idx_alert_metrics_lookup
  ON alert_metrics(organization_id, metric_type, granularity, bucket_start DESC);

COMMIT;

-- Operational metrics and volume facts for the alerting subsystem (range-partitioned by bucket)
CREATE TABLE IF NOT EXISTS alert_metrics_v2 (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  metric_name           VARCHAR(64) NOT NULL,
  bucket                TIMESTAMPTZ NOT NULL,
  count                 BIGINT NOT NULL DEFAULT 0,
  sum                   NUMERIC(20,6) NOT NULL DEFAULT 0,
  dimensions            JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id, bucket)
) PARTITION BY RANGE (bucket);

CREATE TABLE IF NOT EXISTS alert_metrics_v2_default PARTITION OF alert_metrics_v2 DEFAULT;

CREATE INDEX IF NOT EXISTS idx_alert_metrics_v2_query
  ON alert_metrics_v2 (organization_id, metric_name, bucket DESC);

-- Automated telemetry anomaly detection events (range-partitioned by detected_at)
CREATE TABLE IF NOT EXISTS anomaly_detections (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id      UUID NOT NULL,
  environment     TEXT NOT NULL,
  metric_key      TEXT NOT NULL,
  entity_key      TEXT,
  bucket          TIMESTAMPTZ NOT NULL,
  window_size     TEXT NOT NULL,
  observed_value  NUMERIC(20,6) NOT NULL,
  baseline_value  NUMERIC(20,6) NOT NULL,
  baseline_stddev NUMERIC(20,6),
  deviation_sigma NUMERIC(12,4) NOT NULL,
  direction       TEXT NOT NULL,
  severity        TEXT NOT NULL,
  context         JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, detected_at),
  CONSTRAINT anomaly_detections_direction_ck CHECK (direction IN ('spike', 'drop')),
  CONSTRAINT anomaly_detections_severity_ck CHECK (severity IN ('info', 'warning', 'critical'))
) PARTITION BY RANGE (detected_at);

CREATE TABLE IF NOT EXISTS anomaly_detections_default PARTITION OF anomaly_detections DEFAULT;

CREATE INDEX IF NOT EXISTS idx_anomaly_detections_scope_time
  ON anomaly_detections (organization_id, project_id, environment, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_anomaly_detections_metric
  ON anomaly_detections (organization_id, metric_key, detected_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_anomaly_detections_dedupe
  ON anomaly_detections (organization_id, project_id, environment, metric_key,
                        COALESCE(entity_key, ''), bucket, window_size, detected_at);

CREATE INDEX IF NOT EXISTS idx_anomaly_detections_brin
  ON anomaly_detections USING BRIN (detected_at);

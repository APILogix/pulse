-- Ingestion subsystem operational metrics (range-partitioned by captured_at)
CREATE TABLE IF NOT EXISTS ingestion_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID,
  project_id UUID,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC(18,6) NOT NULL,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);

CREATE TABLE IF NOT EXISTS ingestion_metrics_default PARTITION OF ingestion_metrics DEFAULT;

CREATE INDEX IF NOT EXISTS idx_ingestion_metrics_name_time ON ingestion_metrics(metric_name, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_metrics_tenant_time ON ingestion_metrics(organization_id, project_id, metric_name, captured_at DESC) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingestion_metrics_dimensions_gin ON ingestion_metrics USING GIN (dimensions);
CREATE INDEX IF NOT EXISTS idx_ingestion_metrics_brin ON ingestion_metrics USING BRIN (captured_at);

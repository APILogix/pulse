-- Aggregated statistics on reclaimed space and pruned event volumes (range-partitioned by bucket)
CREATE TABLE IF NOT EXISTS retention_statistics (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID,
  project_id UUID,
  table_name TEXT NOT NULL,
  bucket DATE NOT NULL,
  rows_pruned BIGINT NOT NULL DEFAULT 0,
  bytes_pruned BIGINT NOT NULL DEFAULT 0,
  oldest_remaining_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, bucket)
) PARTITION BY RANGE (bucket);

CREATE TABLE IF NOT EXISTS retention_statistics_default PARTITION OF retention_statistics DEFAULT;

CREATE INDEX IF NOT EXISTS idx_retention_statistics_table_bucket ON retention_statistics(table_name, bucket DESC);

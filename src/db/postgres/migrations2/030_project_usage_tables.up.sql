BEGIN;

-- Hourly partitioned table
CREATE TABLE IF NOT EXISTS project_usage_hourly (
    id BIGSERIAL,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    bucket_hour TIMESTAMPTZ NOT NULL,
    event_count BIGINT NOT NULL DEFAULT 0,
    event_bytes BIGINT NOT NULL DEFAULT 0,
    category_counts JSONB DEFAULT '{}',
    event_type_counts JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id, bucket_hour)
) PARTITION BY RANGE (bucket_hour);

-- Create initial partitions (current month + next month)
CREATE TABLE IF NOT EXISTS project_usage_hourly_y2026m07 
    PARTITION OF project_usage_hourly
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE TABLE IF NOT EXISTS project_usage_hourly_y2026m08 
    PARTITION OF project_usage_hourly
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE INDEX IF NOT EXISTS idx_usage_hourly_project_bucket ON project_usage_hourly(project_id, bucket_hour DESC);
CREATE INDEX IF NOT EXISTS idx_usage_hourly_org_bucket ON project_usage_hourly(organization_id, bucket_hour DESC);

-- Daily rollup
CREATE TABLE IF NOT EXISTS project_usage_daily (
    id BIGSERIAL PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    bucket_date DATE NOT NULL,
    total_events BIGINT DEFAULT 0,
    total_bytes BIGINT DEFAULT 0,
    category_counts JSONB DEFAULT '{}',
    event_type_counts JSONB DEFAULT '{}',
    peak_events_per_hour INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, bucket_date)
);

CREATE INDEX IF NOT EXISTS idx_usage_daily_project_date ON project_usage_daily(project_id, bucket_date DESC);
CREATE INDEX IF NOT EXISTS idx_usage_daily_org_date ON project_usage_daily(organization_id, bucket_date DESC);

COMMENT ON TABLE project_usage_hourly IS 'Time-series event ingestion metrics per project per hour';
COMMENT ON TABLE project_usage_daily IS 'Pre-aggregated daily usage metrics for fast dashboard queries';
COMMIT;

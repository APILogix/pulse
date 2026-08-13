-- Partitioning Strategy Setup
-- File: 18_partitions/001_partition_setup.sql

-- Documented Partitioning Architecture:
-- Telemetry and usage counters utilize range-based partitioning by date_bucket / occurred_at when deployed to enterprise scale.
-- Default partition handlers keep single-node & local development environments fully compatible without requiring pg_partman.

COMMENT ON TABLE usage_daily_counters IS 'Partitioned by date_bucket range in production deployments';
COMMENT ON TABLE events_requests IS 'Partitioned by occurred_at range in production deployments';
COMMENT ON TABLE events_logs IS 'Partitioned by occurred_at range in production deployments';

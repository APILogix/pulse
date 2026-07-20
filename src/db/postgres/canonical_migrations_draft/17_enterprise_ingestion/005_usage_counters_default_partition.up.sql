-- =============================================================================
-- Module      : Enterprise Ingestion / Billing
-- Migration   : 005_usage_counters_default_partition.up.sql
-- Description : DEFAULT partition for usage_daily_counters.
--
-- Justification: the usage rollup job writes daily counters for the current
-- month. The table ships with a single example partition (2026_07); any
-- insert outside its range raises an error and would silently drop billable
-- usage. A DEFAULT partition guarantees writes never fail; the rollup job
-- still creates proper monthly partitions ahead of time and operators can
-- detach/re-attach rows from DEFAULT during maintenance.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS usage_daily_counters_default
  PARTITION OF usage_daily_counters DEFAULT;

COMMIT;

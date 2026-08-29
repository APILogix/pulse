BEGIN;

-- ============================================================================
-- Remove remaining unused JSONB GIN indexes from the ingestion hot path.
--
-- 025_request_ingestion_hot_path.sql and 029_span_log_ingestion_hot_path.sql
-- already dropped the equivalent broad attributes/metadata/payload/ai_response
-- (and context/tags/extra) GIN indexes on events_requests, events_spans, and
-- events_logs, because production profiling showed batch INSERT/COMMIT time
-- dominated by JSONB document tokenization on every inserted row, and a
-- repo-wide audit found no query path anywhere (observability explorer,
-- analytics-engine rollups, alerting evaluator, AI investigation context)
-- that issues a JSONB containment/path query (`@>`, `->`, `->>`, `?`,
-- jsonb_path_query) against these columns on ANY events_* table. The
-- observability query-engine's own field registry marks every one of these
-- columns non-filterable (`filterable: false`), so the explorer layer cannot
-- even generate a predicate against them.
--
-- The remaining events_* tables (errors, metrics, traces, messages, profiles,
-- replays, cron_checkins) still carried the same class of GIN index and were
-- missed by that earlier remediation. This migration closes that gap.
--
-- What is NOT changed:
--   - The metadata/payload/attributes/ai_response (and context/tags/extra)
--     COLUMNS themselves are untouched. They are still written by the
--     ingestion writer and still read back verbatim for the request/error
--     detail "raw event" / developer-tools views
--     (src/modules/observability/request-detail.ts,
--      src/modules/observability/error-detail.ts). Only the GIN indexes -
--     write-path overhead with no matching read path - are removed.
--   - Tenant/time/correlation btree indexes, unique event-identity indexes,
--     and BRIN time-scan indexes on every table are untouched.
--
-- These tables are range-partitioned by occurred_at, so these names refer to
-- partitioned parent indexes; PostgreSQL rejects DROP INDEX CONCURRENTLY for
-- partitioned indexes (same constraint documented in 025/029), so this runs
-- as a normal transactional DROP like its predecessors.
-- ============================================================================

-- events_errors (002_events_errors.sql)
DROP INDEX IF EXISTS idx_events_errors_context_gin;
DROP INDEX IF EXISTS idx_events_errors_tags_gin;
DROP INDEX IF EXISTS idx_events_errors_extra_gin;
DROP INDEX IF EXISTS idx_events_errors_metadata_gin;
DROP INDEX IF EXISTS idx_events_errors_payload_gin;
DROP INDEX IF EXISTS idx_events_errors_ai_response_gin;

-- events_metrics (004_events_metrics.sql)
DROP INDEX IF EXISTS idx_events_metrics_attributes_gin;
DROP INDEX IF EXISTS idx_events_metrics_metadata_gin;
DROP INDEX IF EXISTS idx_events_metrics_payload_gin;
DROP INDEX IF EXISTS idx_events_metrics_ai_response_gin;

-- events_traces (006_events_traces.sql)
DROP INDEX IF EXISTS idx_events_traces_attributes_gin;
DROP INDEX IF EXISTS idx_events_traces_metadata_gin;
DROP INDEX IF EXISTS idx_events_traces_payload_gin;
DROP INDEX IF EXISTS idx_events_traces_ai_response_gin;

-- events_messages (007_events_messages.sql)
DROP INDEX IF EXISTS idx_events_messages_attributes_gin;
DROP INDEX IF EXISTS idx_events_messages_metadata_gin;
DROP INDEX IF EXISTS idx_events_messages_payload_gin;
DROP INDEX IF EXISTS idx_events_messages_ai_response_gin;

-- events_profiles (008_events_profiles.sql)
DROP INDEX IF EXISTS idx_events_profiles_attributes_gin;
DROP INDEX IF EXISTS idx_events_profiles_metadata_gin;
DROP INDEX IF EXISTS idx_events_profiles_payload_gin;
DROP INDEX IF EXISTS idx_events_profiles_ai_response_gin;

-- events_replays (009_events_replays.sql)
DROP INDEX IF EXISTS idx_events_replays_attributes_gin;
DROP INDEX IF EXISTS idx_events_replays_metadata_gin;
DROP INDEX IF EXISTS idx_events_replays_payload_gin;
DROP INDEX IF EXISTS idx_events_replays_ai_response_gin;

-- events_cron_checkins (010_events_cron_checkins.sql)
DROP INDEX IF EXISTS idx_events_cron_checkins_attributes_gin;
DROP INDEX IF EXISTS idx_events_cron_checkins_metadata_gin;
DROP INDEX IF EXISTS idx_events_cron_checkins_payload_gin;
DROP INDEX IF EXISTS idx_events_cron_checkins_ai_response_gin;

COMMIT;

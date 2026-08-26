-- ============================================================================
-- Request ingestion hot-path optimization
--
-- Production profiling showed request batches spending most time inside
-- INSERT/COMMIT even for tiny batches. The request table had several broad
-- JSONB GIN indexes and a trigger that rewrote metadata on every row even
-- though the writer already supplies normalized metadata and payload.
--
-- Keep tenant/time/explorer indexes, but remove broad JSON document indexes
-- from the synchronous insert path. events_requests is partitioned, so these
-- named indexes are partitioned parent indexes and PostgreSQL does not allow
-- dropping them CONCURRENTLY.
-- ============================================================================

DROP INDEX IF EXISTS idx_events_requests_payload_gin;
DROP INDEX IF EXISTS idx_events_requests_ai_response_gin;
DROP INDEX IF EXISTS idx_events_requests_metadata_gin;
DROP INDEX IF EXISTS idx_events_requests_attributes_gin;

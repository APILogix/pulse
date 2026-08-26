-- Minimize events_requests write amplification for the ingestion hot path.
--
-- Keep:
--   - idx_events_requests_event_unique: idempotency / at-least-once delivery
--   - idx_events_requests_tenant_time: primary tenant timeline access path
--   - idx_events_requests_occurred_brin: cheap time pruning for append-heavy data
--   - idx_events_requests_pubid: public event lookup contract
--
-- Drop high-cardinality dashboard/convenience indexes that add one btree
-- maintenance operation per inserted request row. Query paths that need these
-- dimensions should use rollups, BRIN/time-bounded scans, or a deliberately
-- reintroduced narrow index backed by EXPLAIN evidence.
--
-- events_requests is partitioned, so these names refer to partitioned parent
-- indexes. PostgreSQL rejects DROP INDEX CONCURRENTLY for partitioned indexes.

DROP INDEX IF EXISTS idx_events_requests_tenant_env_time;
DROP INDEX IF EXISTS idx_events_requests_user_time;
DROP INDEX IF EXISTS idx_events_requests_trace;
DROP INDEX IF EXISTS idx_events_requests_service;
DROP INDEX IF EXISTS idx_events_requests_endpoint_time;
DROP INDEX IF EXISTS idx_events_requests_duration_time;
DROP INDEX IF EXISTS idx_events_requests_geo_time;
DROP INDEX IF EXISTS idx_events_requests_release_time;
DROP INDEX IF EXISTS idx_events_requests_session_time;
DROP INDEX IF EXISTS idx_events_requests_sdk_time;

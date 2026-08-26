-- Minimize span/log write amplification for the ingestion hot path.
--
-- events_spans and events_logs are range-partitioned by occurred_at. These
-- names are partitioned parent indexes, so PostgreSQL does not allow
-- DROP INDEX CONCURRENTLY here.
--
-- Keep the typed-column indexes used by trace hierarchy, request correlation,
-- severity, endpoint, service, and time-window reads. Drop broad JSONB GIN
-- indexes that tokenize large documents on every inserted span/log row and
-- have no current production query path in this repo using JSONB containment.

DROP INDEX IF EXISTS idx_events_spans_attributes_gin;
DROP INDEX IF EXISTS idx_events_spans_metadata_gin;
DROP INDEX IF EXISTS idx_events_spans_payload_gin;
DROP INDEX IF EXISTS idx_events_spans_ai_response_gin;

DROP INDEX IF EXISTS idx_events_logs_context_gin;
DROP INDEX IF EXISTS idx_events_logs_tags_gin;
DROP INDEX IF EXISTS idx_events_logs_attributes_gin;
DROP INDEX IF EXISTS idx_events_logs_metadata_gin;
DROP INDEX IF EXISTS idx_events_logs_payload_gin;
DROP INDEX IF EXISTS idx_events_logs_ai_response_gin;

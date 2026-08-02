BEGIN;

DROP INDEX IF EXISTS idx_events_traces_status_time;
DROP INDEX IF EXISTS idx_events_traces_endpoint_time;
DROP INDEX IF EXISTS idx_events_traces_request_time;
DROP INDEX IF EXISTS idx_events_traces_trace_time;

DROP INDEX IF EXISTS idx_events_spans_depth;
DROP INDEX IF EXISTS idx_events_spans_tenant_time;
DROP INDEX IF EXISTS idx_events_spans_db_system_time;
DROP INDEX IF EXISTS idx_events_spans_http_status_time;
DROP INDEX IF EXISTS idx_events_spans_http_method_time;
DROP INDEX IF EXISTS idx_events_spans_type_time;
DROP INDEX IF EXISTS idx_events_spans_endpoint_time;
DROP INDEX IF EXISTS idx_events_spans_request_time;
DROP INDEX IF EXISTS idx_events_spans_parent_time;
DROP INDEX IF EXISTS idx_events_spans_span_id;
DROP INDEX IF EXISTS idx_events_spans_trace_time;

ALTER TABLE events_spans
    DROP COLUMN IF EXISTS span_kind,
    DROP COLUMN IF EXISTS span_type,
    DROP COLUMN IF EXISTS span_status,
    DROP COLUMN IF EXISTS is_root_span,
    DROP COLUMN IF EXISTS is_http_span,
    DROP COLUMN IF EXISTS is_db_span,
    DROP COLUMN IF EXISTS is_cache_span,
    DROP COLUMN IF EXISTS is_messaging_span,
    DROP COLUMN IF EXISTS message,
    DROP COLUMN IF EXISTS endpoint,
    -- occurred_at is the partition key, DO NOT DROP IT
    DROP COLUMN IF EXISTS http_target,
    DROP COLUMN IF EXISTS http_scheme,
    DROP COLUMN IF EXISTS http_flavor,
    DROP COLUMN IF EXISTS http_status_text,
    DROP COLUMN IF EXISTS http_response_size,
    DROP COLUMN IF EXISTS http_user_agent,
    DROP COLUMN IF EXISTS client_ip_hash,
    DROP COLUMN IF EXISTS net_transport,
    DROP COLUMN IF EXISTS net_host_name,
    DROP COLUMN IF EXISTS net_host_ip,
    DROP COLUMN IF EXISTS net_host_port,
    DROP COLUMN IF EXISTS net_peer_ip,
    DROP COLUMN IF EXISTS net_peer_port;

ALTER TABLE events_traces
    DROP COLUMN IF EXISTS http_method,
    DROP COLUMN IF EXISTS response_size,
    DROP COLUMN IF EXISTS span_kind,
    DROP COLUMN IF EXISTS root_span_status,
    DROP COLUMN IF EXISTS user_agent,
    DROP COLUMN IF EXISTS client_ip_hash;

COMMIT;
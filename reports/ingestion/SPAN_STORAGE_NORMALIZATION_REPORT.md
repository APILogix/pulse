# Span Storage Normalization Report

## Existing Schema Audit

- `events_spans` already had core identity, timing, JSON, DB, HTTP, messaging, SDK metadata, `payload`, and `metadata` columns from `002_typed_event_runtime.up.sql` / `005_create_sdk_event_tables_if_missing.up.sql`.
- The previous `008_trace_normalization.up.sql` only added `depth` to `events_spans`; most work was trace-table focused.
- Existing ingestion populated `kind`, `status`, `status_message`, `db_*`, `http_method`, `http_url`, `http_status_code`, `http_host`, `http_route`, and `messaging_*`, but left raw OpenTelemetry semantic attributes duplicated inside `attributes`.
- Trace-tree ingestion wrote child spans into `events_spans`, but did not populate DB/HTTP/messaging normalized columns from child span attributes.
- Analytics workers already read normalized span columns (`duration_ms`, `exclusive_duration_ms`, `db_system`, `http_host`, `http_url`, `messaging_destination`, `kind`, `status`), so compatibility aliases remain populated.

## Duplicate Columns And Mappings

- Compatibility columns `kind` and `status` are retained for existing analytics. Canonical columns `span_kind` and `span_status` are now also populated.
- Previously duplicated semantic values in `attributes` included `http.*`, `net.*`, `db.*`, `messaging.*`, `pulse.request_id`, and `pulse.tenant_id`. New ingestion removes these from stored `attributes`.
- `payload` and `metadata` remain retained as debug/reference copies, not canonical query sources.

## Incorrect Or Missing Mappings Fixed

- Added canonical extraction for `endpoint`, `http_target`, `http_scheme`, `http_flavor`, `http_status_text`, `http_response_size`, `http_user_agent`, `client_ip_hash`, `net_*`, `span_type`, and classification booleans.
- `request_id` now falls back to `attributes.pulse.request_id`.
- `tenant_id` now falls back to `attributes.pulse.tenant_id`.
- `db_statement` now falls back to `attributes.query`.
- Trace-tree span rows now normalize child span attributes instead of storing only raw JSON.

## Missing Columns Added

- Classification: `span_kind`, `span_type`, `span_status`, `is_root_span`, `is_http_span`, `is_db_span`, `is_cache_span`, `is_messaging_span`.
- Names: `message`, `endpoint`.
- Timing: `occurred_at`.
- HTTP: `http_target`, `http_scheme`, `http_flavor`, `http_status_text`, `http_response_size`, `http_user_agent`, `client_ip_hash`.
- Network: `net_transport`, `net_host_name`, `net_host_ip`, `net_host_port`, `net_peer_ip`, `net_peer_port`.

## Canonical Mapping

- Payload fields map to first-class columns: `eventId`, `traceId`, `spanId`, `parentSpanId`, `requestId`, `sessionId`, `tenantId`, `name`, `kind`, `status`, `startTime`, `endTime`, `duration`, `exclusiveDuration`, `timestamp`, and `metadata.*`.
- OpenTelemetry semantic attributes map to HTTP, network, DB, and messaging columns.
- Remaining custom business attributes stay in `attributes`.
- Full original event remains in `payload`.

## Worker, Repository, DTO, Validator, API Changes

- Updated `TelemetryWriter.writeSpans` for standalone span ingestion.
- Updated trace-tree span expansion to populate the same normalized columns.
- Updated spans explorer resource so search/API queries can filter/project `spanType`, `spanKind`, `spanStatus`, `endpoint`, HTTP/network detail fields, and classification booleans.
- Existing Zod validator accepts `attributes`, `events`, and `links` as flexible objects/arrays, so no validator schema change was required.

## SQL Generated

- Forward migration: `database/migrations/logdb/03_observability/008_trace_normalization.up.sql`.
- Rollback migration: `database/migrations/logdb/03_observability/008_drop_trace_normalization.down.sql`.
- Fresh-install schema updates: `002_typed_event_runtime.up.sql` and `005_create_sdk_event_tables_if_missing.up.sql`.

## New Indexes

- Span indexes: trace/time, span id, parent/time, request/time, endpoint/time, type/time, HTTP method/time, HTTP status/time, DB system/time, tenant/time, and depth.
- Trace indexes retained for trace, request, endpoint, and status query paths.

## Query Performance Improvements

- Common dashboard/search filters no longer need JSON extraction for HTTP, DB, messaging, network, endpoint, status, tenant, or classification fields.
- Semantic attributes are stripped after extraction, reducing JSON payload bloat for custom attribute scans.
- Partial indexes keep sparse dimensions from bloating common lookup paths.

## Remaining Recommendations

- Migrate analytics workers from compatibility `kind/status` to canonical `span_kind/span_status` in a follow-up.
- Add database-backed migration integration coverage for the new `008` migration once a log DB test container is available in CI.
- Hash `client_ip_hash` before storage if SDKs still send raw client IP in `http.client_ip`; the current code preserves the prior column name but does not cryptographically hash it.

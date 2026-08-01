# Phase 4 — Log DB Audit

Instance: `LOG_DB_PRIMARY` (separate Postgres from the control plane).
Runner: `src/shared/logdb/migrations.ts` → `database/migrations/logdb/**`
(advisory lock `74373201`, ledger table `logdb_migrations`).
Live physical table count (from `docs/logdb-table-inventory.md`): **201**
(90 default partitions + 111 parents/reference/internal).

No table in this tree carries a foreign key to the control plane; primary-DB ids
are stored as bare `UUID`/`TEXT`. Ownership is enforced in application code.

---

## 1. Migration tree

| Dir | Files | Purpose | Applied objects |
| --- | --- | --- | --- |
| `00_shared` | `001_foundation`, `002_alerting_v2_types` | extensions (`pgcrypto`, `btree_gin`), `logdb_set_updated_at()`, enums (`logdb_job_state`, `logdb_severity`, `logdb_delivery_status`, `logdb_ai_status`), `logdb_schema_notes` | 1 table, 4 enums, 1 function |
| `01_usage` | `001_usage_rollups` | **inert** — declares usage/billing ledger authoritative in the control plane | none |
| `02_ingestion` | `001_ingestion_runtime`, `002_ingestion_fix` (empty) | `ingestion_queue_snapshot`, `ingestion_metrics`, `worker_performance`, `backpressure_gauge`, `ingestion_failures` | 5 partitioned tables |
| `03_observability` | `001_canonical_events`, `002_typed_event_runtime`, `003_add_events_metrics_request_id` | the 10 canonical `events_*` tables, typed column projections, `logdb_sync_typed_event_contract()` trigger | 10 partitioned tables + 1 trigger fn |
| `04_analytics` | `001_analytics_runtime`, `002_typed_analytics_runtime` | generic rollups, error groups, perf summary, sessions, 9 templated entity rollups, service edges, dashboards/saved queries/analytics alerts | 18 tables |
| `05_connectors_runtime` | `001`, `002_connector_runtime_v2` | connector deliveries, attempts, health checks, test runs, audit | 5 partitioned tables |
| `06_alert_runtime` | `001`, `002_alert_runtime_v2` | alert events/batches/history/deliveries/DLQ/throttle/metrics/acks/rule executions | 10 partitioned tables |
| `07_ai_runtime` | `001_ai_runtime` | ai requests/responses/jobs/cache/reports/insights/evaluations/feedback/tool calls/usage receipts | 10 partitioned tables |
| `08_automation_runtime` | `001_automation_runtime` | automation runs, run steps, events inbox, audit logs | 4 partitioned tables |
| `09_search` | `001_search_indexes` | `log_search_index`, `trace_search_index`, `error_search_index` (tsvector + facets + embedding) | 3 partitioned tables |
| `10_lookup` | `001_lookup_dimensions`, `002_environment_sdk_config_lookup`, `003_environment_string_contract` | `organization_lookup`, `project_lookup`, `environment_lookup`, `release_lookup`, `api_key_lookup`, 8 `telemetry_dimensions_*` | 13 unpartitioned reference tables |
| `11_geo` | `001_geo_reference` | `geo_countries`, `geo_networks`, `geo_locations` | 3 reference tables |
| `12_retention` | `001_retention` | `retention_jobs`, `retention_statistics` | 2 partitioned tables |
| `13_legacy` | `001_legacy_compat` | **inert** — explicitly refuses to recreate the pre-canonical telemetry schema | none |

## 2. Canonical telemetry tables (analytics inputs)

All ten share the same storage core and are `PARTITION BY RANGE (occurred_at)`
with a `_default` partition. `logdb_sync_typed_event_contract()` keeps
`timestamp = occurred_at`, `created_at = ingested_at`, forces
`metadata = {"environment": <environment>}`, and backfills `payload` from the row
when the writer leaves it empty.

| Table | Signal | Type-specific columns used by analytics | Write freq | Read freq | Consumers |
| --- | --- | --- | --- | --- | --- |
| `events_requests` | HTTP request | `url`, `method`, `route`, `latency_ms`, `status_code`, `body_size`, `response_size`, `client_ip`, `client_ip_hash`, `geo_country_code`, `geo_region`, `geo_asn`, `browser_family`, `browser_version_major`, `os_name`, `os_version_major`, `device_type`, `is_bot`, `is_slow` (generated), `is_error` (generated), `tenant_id`, `user_agent`, `referer`, `framework`, `release`, `sdk_name`, `sdk_version`, `user_id`, `session_id`, `trace_id`, `request_id` | very high | high | requests/latency/geo/endpoints/services/slo/security/business analytics |
| `events_errors` | exception | `fingerprint`, `error_name`, `stack_hash`, `stack_frames`, `source_context`, `mechanism`, `source`, `breadcrumbs`, `tags`, `extra`, `contexts`, `user_email`, `user_ip`, `server_name`, `application_name/_version`, `request_id` | high | high | errors/error-groups/releases/security analytics |
| `events_logs` | log line | `level`, `logger`, `args`, `context`, `tags`, `request_id`, `user_ip` | very high | medium | logs analytics, log search |
| `events_metrics` | metric point | `metric_name`, `metric_type`, `value`, `unit`, `tags`, `count`, `sum`, `min`, `max`, `avg`, `rate`, `buckets`, `p50…p99`, `request_id` | high | medium | metrics + runtime (heap / event-loop / GC) analytics |
| `events_spans` | span | `kind`, `status`, `status_message`, `start_time`, `end_time`, `exclusive_duration_ms`, `events`, `links`, `db_system`, `db_name`, `db_operation`, `db_collection`, `db_statement`, `http_method`, `http_url`, `http_status_code`, `http_host`, `http_route`, `messaging_*`, `request_id`, `tenant_id` | very high | high | span/dependency/db analytics |
| `events_traces` | trace | `root_span_name`, `root_span_id`, `span_count`, `total_duration_ms`, `is_partial`, `spans_tree`, `request_id`, `tenant_id` | high | high | trace analytics, service map |
| `events_messages` | SDK message | `request_id`, `server_name`, `application_*`, `tags`, `contexts`, `breadcrumbs`, `user_ip` | medium | low | events explorer |
| `events_profiles` | CPU/mem profile | `profile_type`, `start_time`, `end_time`, `profile_data`, `request_id` | low | low | profile analytics |
| `events_replays` | session replay | `segment_id`, `events` | medium | low | replay analytics |
| `events_cron_checkins` | cron check-in | `monitor_slug`, `status` | low | medium | cron analytics |

Shared indexes per table (created by `001_canonical_events`):
unique `(organization_id, event_id, occurred_at)`;
btree `(organization_id, project_id, occurred_at DESC)`;
btree `(organization_id, project_id, environment, occurred_at DESC)`;
partial btree on `trace_id`, partial btree on `service`;
GIN on `attributes`, `metadata`, `payload`; BRIN on `occurred_at`.
Extra: `events_errors(organization_id, project_id, fingerprint, timestamp DESC)`,
`events_requests(…, route, timestamp DESC)`, `events_requests(…, user_id, …)`,
`events_metrics(…, metric_name, timestamp DESC)`,
`events_metrics(…, request_id, …) WHERE request_id IS NOT NULL`,
`events_logs(…, level, timestamp DESC)`.

### Index gaps that block rollup workers
| Missing index | Needed by |
| --- | --- |
| `events_requests(organization_id, project_id, environment, ingested_at)` | watermark-driven incremental scans (`ingested_at`, not `occurred_at`, is the safe progress key for late events) |
| same on the other nine `events_*` tables | all rollup workers |
| `events_errors(organization_id, project_id, environment, ingested_at)` | error grouping |
| `events_spans(organization_id, project_id, db_system, timestamp DESC) WHERE db_system IS NOT NULL` | DB query analytics |
| `events_spans(organization_id, project_id, http_host, timestamp DESC) WHERE http_host IS NOT NULL` | external dependency analytics |
| `events_requests(organization_id, project_id, geo_country_code, timestamp DESC)` | geo analytics |
| `events_requests(organization_id, project_id, release, timestamp DESC)` | release analytics |

## 3. Existing analytics tables (`04_analytics`)

| Table | Shape | Partitioned by | Owner today | Verdict |
| --- | --- | --- | --- | --- |
| `analytics_hourly_rollup` | generic `(metric_name, metric_value, dimensions jsonb)` EAV | `bucket` | `analytics.rollup-hourly` job | **deprecate** — EAV forces per-metric filtering, no percentile columns, dimension GIN scans |
| `analytics_daily_rollup` | same EAV | `bucket` | none (never written) | **deprecate / unused** |
| `analytics_geo_hourly_rollup` | `country_code, region, city, requests, errors, p95` | `bucket` | none (never written) | **keep shape, re-own** by `analytics.geo` (add browser/os/device siblings) |
| `analytics_error_groups` | group state (`fingerprint`, counts, `services[]`, `environments[]`, `releases[]`, priority, resolution) | not partitioned | `analytics.error-grouping` job + v1 API writes | **keep** — it is UI-mutable state, not a rollup |
| `analytics_performance_summary` | `service, endpoint, request_count, error_count, p50/p95/p99, route, method, error_rate, apdex_score` | `bucket` | none (never written) | **supersede** by explicit `analytics_endpoint_*` / `analytics_service_*` |
| `analytics_user_sessions` | session facts (`session_id`, `started_at`, `ended_at`, `duration_ms`, `is_crashed`) | `started_at` | none (never written) | **keep, re-own** by `analytics.sessions` |
| `analytics_endpoint_minute/hourly/daily` | templated `(entity_key, total_count, error_count, latency_ms_p95, attributes)` | `bucket` | none (never written) | **supersede** — single p95 column cannot serve P50/P75/P90/P99 |
| `analytics_service_minute/hourly/daily` | same template | `bucket` | none | **supersede** |
| `analytics_trace_latency` | same template | `bucket` | none | **supersede** |
| `analytics_error_occurrences` | same template | `bucket` | none | **keep shape, re-own** by `analytics.errors` |
| `analytics_error_regressions` | same template | `bucket` | none | **keep, re-own** |
| `analytics_trace_service_edges` | `source_service, target_service, call_count, error_count, p95` | `bucket` | none | **keep, re-own** by `analytics.traces` |
| `analytics_dashboards` | user-defined dashboards | no | API | keep (control surface) |
| `analytics_saved_queries` | saved queries | no | API | keep (control surface) |
| `analytics_alerts` | metric threshold definitions | no | API | **conflict** — overlaps the alerting module's rule model; see coverage report |

## 4. Orphaned / duplicate physical tables (live DB, no owning migration)

`13_legacy/001` and `01_usage/001` are intentionally inert, yet the live database
still carries pre-canonical tables from earlier schema generations:

| Group | Tables | Status |
| --- | --- | --- |
| Legacy telemetry | `errors`, `logs`, `messages`, `metrics`, `profiles`, `replays`, `requests`, `spans`, `traces`, `cron_checkins`, `error_groups` (+ `_default`) | duplicate of `events_*`; no writer in the current codebase |
| Legacy usage rollups | `api_key_usage_{minute,hourly,daily}`, `environment_usage_*`, `organization_usage_*`, `project_usage_*`, `usage_counter_staging` | contradicts `01_usage` (control plane is authoritative) |
| Legacy ingestion | `ingestion_jobs`, `ingestion_dead_letter_jobs`, `ingestion_admin_logs`, `ingestion_hourly_summary` | superseded by pg-boss per-type queues; `main.ts` comments confirm the poller was removed |
| Misc | `sdk_sessions` | unclear owner; candidate source for `analytics.sessions` or drop |

Handling: the analytics engine **must not read or write any of these**. A
migration that drops them is a separate, destructive change and is therefore
listed as an explicit human-approval item in `14-implementation-roadmap.md`
rather than being executed by the analytics work.

## 5. Retention & partitioning reality check

- Partition creation currently depends on `SELECT create_event_partitions(7)`
  invoked by `analytics.partition-maintain` (`src/modules/event-analytics/queue.ts`).
  That function is **not defined in any migration in this tree** — so the job
  either relies on a function created out-of-band or fails silently inside its
  `catch`. The analytics engine therefore ships its own idempotent
  `analytics_engine_ensure_partitions(days int)` and does not depend on the old
  helper. (Verification note: the job wraps queue creation in `.catch()`, and the
  `SELECT create_event_partitions(7)` call is unguarded, so a missing function
  surfaces as a failed pg-boss job rather than a startup error.)
- Every partitioned table has only a `_default` partition in the migration tree.
  Without real range partitions, retention pruning degrades to `DELETE`, and the
  default partition grows unboundedly.
- `retention_jobs` / `retention_statistics` exist but no worker in
  `src/shared/workers/**` claims them (`retention.processor.ts` is a 226-byte
  stub). Analytics retention is therefore implemented inside the analytics engine
  for analytics-owned tables only.

## 6. Read/write ownership matrix the engine will honour

| Table group | Written by | Read by |
| --- | --- | --- |
| `events_*` | ingestion worker only (`TelemetryWriter`) | analytics workers (read-only), event list APIs |
| `analytics_engine_*` (new) | analytics workers only | dashboard APIs only |
| `analytics_error_groups` | `analytics.errors` worker + error-triage API mutations | dashboard APIs, alerting |
| `analytics_engine_watermarks` (new) | analytics workers only | analytics workers, health endpoint |
| lookup / dimension tables | `src/shared/logdb/lookup-sync.ts` | analytics workers (label enrichment) |
| `geo_*` | reference loader | `analytics.geo` |
| alert / ai / automation / connector runtime | their own modules | their own modules (analytics may read alert metrics for `/alerts/metrics`) |
| control-plane DB | control-plane modules | **never** read by analytics workers for telemetry (billing rate card is the single documented exception, read through the billing module's service, not by SQL) |

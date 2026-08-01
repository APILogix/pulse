# Deviations from the approved analytics architecture

Every difference between the design documents and the shipped code is recorded
here. Nothing is silently changed.

| # | Design says | Implementation does | Why | Impact |
| --- | --- | --- | --- | --- |
| D1 | `ingest_health_metrics_5m.ingest_lag_ms_p95` | column is `ingest_lag_p95_ms` | the shared latency-block helper generates `<prefix>_p95_ms`; using it keeps one merge path for every percentile column | naming only; catalog metric key `ingestion.lag_p95` is unchanged |
| D2 | 26 workers registered in the first implementation wave | 15 domain workers + 5 platform jobs are registered (`requests`, `endpoints`, `services`, `errors`, `logs`, `spans`, `traces`, `metrics`, `runtime`, `crons`, `geo`, `sdk`, `releases`, `profiles`, `replays`) | Wave 2 covered P0; Wave 5 has added the geo/sdk/releases/profiles/replays group. The remaining 8 (`sessions`, `security`, `usage`, `slo`, `alerts`, `ai`, `anomalies`, `health`) are specified and follow the same pattern | routes for unregistered domains return `meta.freshness.stale = true` with empty payloads, as the roadmap specifies |
| D3 | `analytics_error_groups.total_count` maintained by the errors worker | the worker writes only observation columns (`first_seen_at`, `last_seen_at`, name, message, service/env/release arrays); counts come from `error_group_metrics_*` | `total_count = existing + new` is **not** idempotent, so a replayed slice would inflate it — that directly violates the replay guarantee | occurrence counts are summed from rollups at read time; the state table keeps only triage state |
| D4 | every rollup statement emits project/environment sentinel roll-up rows | the generic recompute helper does; three hand-written statements do not (`error_dimension_metrics_1h`, `trace_edge_metrics_1h`, `cron_monitor_state`) | those statements need multi-source CTEs or window functions that do not compose with `GROUPING SETS` | reads for `environment=all` sum the per-environment rollup rows for those three tables. Still no raw-telemetry aggregation |
| D5 | HLL sketches produced alongside counters in one statement | sketches are built in a second pass in Node, inside the same transaction | Postgres cannot build HLL without an extension, and the extension is not guaranteed in the target Log DB (`13-architecture-review.md` W3) | one extra bounded distinct-value query per sketch column; sketch is `NULL` when the distinct set exceeds `ANALYTICS_BATCH_MAX_ROWS`, and readers then fall back to `MAX(*_exact)` |
| D6 | `traces.critical_path_p95` computed from the span tree | approximated by the trace-duration p95 | span-tree walking is P2 in `12-coverage-report.md` §7 | documented approximation; the column exists so the real computation is a drop-in change |
| D7 | `service_metrics_*.span_count` / `error_group_count` populated by the services worker | written as `0` | those values belong to `analytics.spans` and `analytics.errors`; a second writer would break single-writer ownership | the read layer joins `span_metrics_*` / `error_group_metrics_*` instead |
| D8 | one file per domain worker | true, but simple workers share `defineSimpleRollupWorker` | 10+ near-identical files would drift apart; the factory guarantees identical batching, idempotency and transaction semantics | behaviour identical; each worker still owns its own file, queue, watermark and tables |
| D9 | verification by running build + tests | not executed in this session | the environment exposes no command-execution tool to this agent | code was verified by inspection against `tsconfig.json` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`); tests are written and committed but **have not been run**. This is the single most important open item |
| D10 | flat v2 paths, e.g. `GET /analytics/v2/requests/summary` with implicit org scope | routes are nested: `/analytics/v2/org/:orgId/...` and `/analytics/v2/projects/:projectId/...` | lets the existing `requireOrgMembership` / `requireProjectMembership` guards apply unchanged instead of inventing a second org-resolution path (the v1 module already relies on `:projectId` in the path) | tenant isolation is enforced by proven middleware; the frontend passes the scope it is already routing on |
| D11 | Wave 4 delivers all 60+ routes | 12 scoped routes + 2 global routes are live (requests summary/series/status/histogram, endpoints, endpoints/slowest, errors summary/groups, logs summary, traces summary, services, overview, projects/health, system/health) | these cover every P0 widget in the dependency matrix; the rest follow the same three-line pattern once their workers exist | remaining routes are additive; no contract change needed |

| D12 | `device_metrics_1h`, `error_dimension_metrics_1h`, `trace_edge_metrics_1h`, `profile_function_metrics_1h` and `release_comparison` are written by the generic recompute helper | they are written by hand-authored SQL inside their owning worker | each needs `UNION ALL` dimension unfolding, a self-join, `jsonb_array_elements`, or a window function — none of which compose with `GROUPING SETS` | same idempotency (whole-bucket recompute + `ON CONFLICT DO UPDATE`), but no project/environment sentinel rows; see D4 |
| D13 | `replay_metrics_1h.crashed_session_count` written by `analytics.replays` | written as `0` | crash attribution requires correlating replay sessions with fatal errors, which is `analytics.sessions`' job — a second writer would break single-writer ownership | column is populated once `analytics.sessions` lands |

## Open items before the engine can be declared production-ready

1. Run `npx tsc --noEmit`, `npm test`, and
   `npm run test:integration -- analytics-engine-migrations` and fix anything they
   surface. Nothing in this work has been executed.
2. Apply the two new Log DB migrations against a real database
   (`npm run db:migrate:logdb`).
3. Wave 4: rollup-only read repositories + `/analytics/v2/*` routes.
4. Wave 5: the remaining 13 domain workers.
5. Wave 6: frontend migration off `useDummyData`.

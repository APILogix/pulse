# Analytics Engine — Implementation Progress Ledger

Source of truth for the work driven by `planning/anlatycisprompt.md`.
This file is the agent memory file: read it first, update it at the end of every
work session.

## Ground truth discovered (verified by file reads)

| Fact | Evidence |
| --- | --- |
| Frontend lives outside this repo at `../pulsiv_fe` (React 19 + Vite + TanStack Query + Zustand) | `pulsiv_fe/package.json`, `pulsiv_fe/src/app/router/protected-routes.tsx` |
| Every observability surface is powered by `pulsiv_fe/src/hooks/useDummyData.ts` → `pulsiv_fe/src/lib/dummy-data.ts` (46 KB static fixtures) | read both files |
| Frontend computes percentiles, error rates, group-bys and fabricates trends via `seededSeries()` | `pulsiv_fe/src/pages/dashboards/lib.ts`, `observe/LatencyPage.tsx`, `observe/RuntimeMetricsPage.tsx` |
| Backend analytics module aggregates raw telemetry on the request path (no rollups) | `src/modules/analytics/repository.ts` (`UNIFIED_EVENTS_SQL` 10-table UNION ALL + `PERCENTILE_CONT` per request) |
| Existing "analytics workers" are 3 pg-boss jobs registered inside the shared worker process | `src/modules/event-analytics/queue.ts`, `src/shared/workers/main.ts` |
| Log DB is a separate Postgres instance with its own migration runner | `src/config/log-database.ts`, `src/shared/logdb/migrations.ts`, `database/migrations/logdb/**` |
| Canonical telemetry = 10 partitioned typed tables `events_*` | `database/migrations/logdb/03_observability/001_canonical_events.up.sql` |
| Existing rollups are generic key/value (`analytics_hourly_rollup`, `analytics_daily_rollup`) + a few purpose tables | `database/migrations/logdb/04_analytics/001_analytics_runtime.up.sql` |
| Queue runtime is pg-boss v12 on the control-plane DB; Redis is banned for this stage | `src/lib/pgboss.ts`, `README.md` |

## Phase status

Legend: `TODO` / `WIP` / `DONE` (+ artifact path)

| Phase | Description | Status | Artifact |
| --- | --- | --- | --- |
| 1 | Complete frontend audit | DONE | `docs/analytics/01-frontend-dashboard-audit.md` |
| 2 | Frontend data contract | DONE | `docs/analytics/01-frontend-dashboard-audit.md` §Contract |
| 3 | Dummy data removal audit | DONE | `docs/analytics/02-dummy-data-audit.md` |
| 4 | Log DB audit | DONE | `docs/analytics/03-logdb-audit.md` |
| 5 | Metric discovery | DONE | `docs/analytics/04-metric-discovery.md` |
| 6 | Dashboard optimization | DONE | `docs/analytics/05-dashboard-optimization.md` |
| 7 | Analytics worker design | DONE | `docs/analytics/06-worker-architecture.md` |
| 8 | Per-worker specification | DONE | `docs/analytics/06-worker-architecture.md` §Worker specs |
| 9 | Analytics architecture | DONE | `docs/analytics/00-architecture-overview.md` |
| 10 | Rollup table design | DONE | `docs/analytics/07-rollup-tables.md` |
| 11 | Backend route contracts | DONE | `docs/analytics/08-dashboard-api-contracts.md` |
| 12 | Ingestion isolation guarantee | DONE | `docs/analytics/00-architecture-overview.md` §Isolation |
| 13 | Worker registration design | DONE | `docs/analytics/06-worker-architecture.md` §Process |
| 14 | Implementation | WIP | `src/modules/analytics-engine/**` (Waves 0–3 complete, 4–6 open) |
| 15 | Documentation set | DONE | `docs/analytics/**` (16 documents) |
| 16 | Dependency matrix | DONE | `docs/analytics/09-dependency-matrix.md` |
| 17 | Analytics catalog | DONE | `docs/analytics/10-analytics-catalog.md` |
| 18 | Lineage graph | DONE | `docs/analytics/11-lineage-graph.md` |
| 19 | Coverage report | DONE | `docs/analytics/12-coverage-report.md` |
| 20 | Quality review | DONE | `docs/analytics/13-architecture-review.md` |
| — | Implementation roadmap | DONE | `docs/analytics/14-implementation-roadmap.md` |

## Implementation checklist (Phase 14)

Wave 0 — schema
- [x] Log DB migration `04_analytics/003_analytics_engine_rollups.up.sql` (59 partitioned rollup tables + 6 state/ledger tables + freeze comments)
- [x] Log DB migration `04_analytics/004_analytics_engine_partitions.up.sql` (partition + retention helpers, 10 ingest watermark indexes, 7 dimension indexes)

Wave 1 — engine core
- [x] `types.ts` (windows, sentinels, worker contract, API primitives)
- [x] `windows.ts` (bucket math, window selection, run-window derivation)
- [x] `histogram.ts` (24-bucket log-scale histogram, merge, percentile recovery, SQL builder)
- [x] `hll.ts` (dependency-free HyperLogLog, 2^14 registers)
- [x] `watermark.repository.ts` (watermarks, run ledger, health, pool assertion)
- [x] `rollup-writer.ts` (idempotent UPSERT builder + INSERT…SELECT builder)
- [x] `workers/base.ts` (batch guard, whole-bucket recompute SQL, transaction harness, worker factory)
- [x] `workers/sketches.ts` (HLL second pass)

Wave 2 — P0 workers
- [x] analytics.requests
- [x] analytics.endpoints
- [x] analytics.services
- [x] analytics.errors
- [x] analytics.logs
- [x] analytics.metrics
- [x] analytics.runtime (heap / event-loop / GC)
- [x] analytics.spans (+ db, dependency)
- [x] analytics.traces (+ service edges)
- [x] analytics.crons (+ monitor state)
- [x] analytics.compaction (1m → 5m → 1h → 1d)
- [x] analytics.retention
- [x] analytics.partitions
- [x] analytics.dispatch (tiered fan-out)

Wave 3 — process
- [x] `registry.ts` with ownership invariants
- [x] `queue.ts` pg-boss registration + dispatcher
- [x] `src/shared/workers/analytics-worker-main.ts`
- [x] health endpoint + Prometheus metrics endpoint
- [x] PM2 app `analytics-workers`, npm scripts `dev:analytics` / `start:analytics`
- [x] `ANALYTICS_*` env schema

Wave 4 — read layer + API
- [x] `read/query-scope.ts` (validation, window selection, sort allowlist, cache keys)
- [x] `read/formatters.ts` (cards with delta/trend/direction/aiContext, zero-filled series, tables, CSV, envelope)
- [x] `read/dashboard.repository.ts` (rollup-only: request/error/log/trace summaries, series, latency histogram + heatmap, top entities, error groups joined to triage state, services, project health)
- [x] `api/analytics-v2.routes.ts` (12 scoped routes × org + project prefixes, 2 global routes)
- [x] `api/route-manifest.ts` (dependency-free contract surface)
- [x] `analytics-engine.module.ts` (LRU response cache, project→org resolver)
- [x] registered in `src/app.ts` at `/analytics/v2`

Wave 5 — remaining workers
- [x] analytics.geo (geo_metrics_1h + device_metrics_1h — replaces `countryForIp` and the user-agent regex)
- [x] analytics.sdk (sdk_metrics_1h)
- [x] analytics.releases (release_metrics_1h + release_comparison verdict)
- [x] analytics.profiles (profile_metrics_1h + profile_function_metrics_1h hot functions)
- [x] analytics.replays (replay_metrics_1h)
- [ ] analytics.sessions (session_metrics_1h, user_metrics_1d, analytics_user_sessions)
- [ ] analytics.security (security_metrics_1h)
- [ ] analytics.usage (usage_metrics_1d, cost_metrics_1d, ingest_health_metrics_5m)
- [ ] analytics.slo (slo_metrics_5m)
- [ ] analytics.alerts (alert_metrics_1h)
- [ ] analytics.ai (ai_metrics_1h)
- [ ] analytics.anomalies (anomaly_detections)
- [ ] analytics.health (project_health_5m)

Wave 6 — frontend
- [ ] analytics API client + hooks in `pulsiv_fe`
- [ ] delete `useDummyData.ts`, `dummy-data.ts`, fabrication helpers
- [ ] ESLint guards against reintroduction

Tests
- [x] `test/unit/analytics-engine-windows.test.ts`
- [x] `test/unit/analytics-engine-sketches.test.ts` (histogram + HLL)
- [x] `test/unit/analytics-engine-registry.test.ts` (ownership, writer SQL, recompute SQL, merge rules, retention scope)
- [x] `test/unit/analytics-engine-read.test.ts` (query parsing, formatters, envelope, no-raw-telemetry invariant, route registration)
- [x] `test/integration/analytics-engine-migrations.test.ts`
- [ ] **none of the above has been executed** — see `DEVIATIONS.md` D9

## Session log

### Session 1 (2026-07-31)
- Read `planning/anlatycisprompt.md`; mapped frontend + backend + Log DB.
- Established that all observability surfaces are dummy-data driven.
- Produced the full Phase 1–20 artifact set under `docs/analytics/`.

### Session 2 (2026-08-01)
- Wave 0: both Log DB migrations.
- Wave 1: engine core (types, windows, histogram, HLL, watermarks, rollup writer,
  worker harness, sketch pass).
- Wave 2: 10 domain workers + compaction + retention + partitions + dispatcher.
- Wave 3: dedicated worker process, health/metrics server, PM2 + npm wiring,
  `ANALYTICS_*` env.
- Wave 4: read layer (query scope, formatters, rollup-only repository), v2 API
  (12 scoped routes × 2 prefixes + 2 global), module wired into `src/app.ts`.
- Tests written for every pure primitive plus schema/idempotency integration and
  the no-raw-telemetry read invariant.
- Fixed by inspection: SQL comment swallowing `ON CONFLICT`; non-idempotent
  error-group counter; `last_seen_at` merge rule; unsafe `Buffer.from` overload;
  leftover `arguments.length` expression in route registration; dynamic imports
  replaced with static ones.
- Recorded 11 deviations in `docs/analytics/DEVIATIONS.md`.

## Next session — start here

1. Run and fix: `npx tsc --noEmit`, then `npm test`, then
   `npm run test:integration -- analytics-engine-migrations`.
2. Apply the migrations: `npm run db:migrate:logdb`.
3. Boot the worker: `npm run dev:analytics`, then check
   `curl localhost:9301/health` and `curl localhost:9301/metrics`.
4. Wave 5: add the remaining 13 domain workers (each is a ~60-line file using
   `defineSimpleRollupWorker`, plus a registry entry).
5. Wave 6: frontend migration, module by module, per
   `02-dummy-data-audit.md` §3.



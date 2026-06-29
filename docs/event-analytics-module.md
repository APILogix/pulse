# Event Analytics Module (Pulse SDK)

Read-optimized analytics over the Pulse SDK event data: 10 partitioned event
tables (`events_*`), rollup/aggregate tables, and config tables (dashboards,
saved queries, analytics alerts) created in
`migrations2/004_add_analytics_module`.

This is a **separate module** (`src/modules/event-analytics/`, decorator
`eventAnalytics`, prefix `/organizations/:orgId/analytics`) from the existing
project-scoped `analytics` module (telemetry, `/analytics/:projectId/...`),
which was left untouched.

Per requirements: **no caching and no rate limiting** anywhere in this module.

## Layout

| File | Responsibility |
|---|---|
| `types.ts` | Zod query schemas, time-range helpers, errors |
| `query-builder.ts` | Safe, allow-listed, fully-parameterized SQL builder |
| `repository.ts` | All org-scoped read queries + config CRUD + rollup helpers |
| `service.ts` | Orchestration (concurrent reads), DTO shaping, audit |
| `waterfall.ts` | Trace waterfall tree builder + Apdex (pure) |
| `csv.ts` | CSV serialization (pure) |
| `routes.ts` | 30+ org-scoped endpoints incl. SSE live feeds |
| `queue.ts` | pg-boss rollup / error-grouping / partition workers |
| `event-analytics.module.ts` | Fastify plugin wiring |

## Performance / scale design

- **Time partitioning**: every event table is `PARTITION BY RANGE (created_at)`
  with daily partitions (plus a DEFAULT catch-all). `create_event_partitions()`
  pre-creates a week; the `analytics.partition-maintain` job keeps a week ahead.
- **Indexes**: composite btrees for hot lookups (`org + timestamp`, route,
  status, severity, fingerprint), GIN for metric tags + log full-text, and BRIN
  on `created_at` for cheap large scans.
- **No N+1**: detail endpoints run independent queries concurrently with
  `Promise.all` (e.g. overview = errors + requests + users in parallel; trace
  waterfall = trace + spans in parallel). Spans for a trace are fetched in one
  query and assembled in memory.
- **Pre-aggregation**: `analytics_hourly_rollup` / `analytics_error_groups` /
  `analytics_performance_summary` are refreshed by background workers so
  dashboard reads hit small rollup tables. Route performance falls back to a
  live single-query aggregate when no summary rows exist yet.
- **Tenant isolation**: every query is scoped by `organization_id` in the
  repository (the query builder forces `organization_id = $1` as the first
  predicate). RLS is left commented in the migration — the codebase never sets
  `app.current_org_id`, so enabling it would zero out results.

## Safety of the query builder

- Table names come only from an internal allow-list (`ANALYTICS_TABLES`); user
  input never reaches an identifier position.
- All values bind as `$n` parameters; nothing is string-concatenated.
- `sortBy` / aggregate-function inputs are constrained by route-level Zod enums
  before any interpolation.

## Endpoints (prefix `/organizations/:orgId/analytics`)

Overview/trends/health · errors (+ groups, resolve/ignore, trends, detail) ·
performance (routes, distribution, apdex) · requests (+ waterfall, detail) ·
traces (list, detail) · metrics (names, series, stats) · logs (+ `/logs/stream`
SSE) · sessions · users (+ journey) · crons (list, detail, history) ·
`live/errors` SSE · dashboards CRUD (+ duplicate) · saved queries CRUD
(+ execute) · analytics alerts CRUD · `POST /export` (CSV/JSON).

All routes require `authenticate` + `requireOrgAccess`.

### Live (SSE)
`/logs/stream` and `/live/errors` stream via a bounded DB poll loop (~3s,
cursor = latest row timestamp) with a 15s heartbeat, cleaned up on disconnect.
This avoids a Redis pub/sub dependency; for very high fan-out a broker-backed
stream would be the next step (documented tradeoff).

## Background workers (pg-boss, worker process)

Registered in `workers/main.ts` via `registerAnalyticsWorkers`:

| Job | Cadence | Purpose |
|---|---|---|
| `analytics.rollup-hourly` | every 5 min (per org) | `refresh_hourly_rollup()` for the trailing 2h |
| `analytics.error-grouping` | every 5 min (per org) | upsert `analytics_error_groups` from recent errors |
| `analytics.partition-maintain` | daily (cron) | `create_event_partitions(7)` |

A worker-side fan-out enumerates orgs with recent events and enqueues per-org
jobs. pg-boss v12 option names are used (`localConcurrency`, `batchSize`,
`expireInSeconds`); the work handler receives an array of jobs.

## Migration notes / fixes vs the spec SQL

- `CREATE BRIN INDEX` → corrected to `CREATE INDEX ... USING BRIN (col)`.
- Time-windowed partial-index predicates (`WHERE created_at > NOW() - ...`) were
  dropped — an index predicate must be IMMUTABLE and `NOW()` is not, so those
  statements would fail. Plain composite indexes are used instead.
- Partitioned tables use composite PK `(id, created_at)` (a partition key must
  be part of every PK/unique constraint in PostgreSQL).
- Enum renamed `metric_type` → `analytics_metric_type` and `event_status` →
  `span_status` to avoid collisions with existing/likely enum names.

## Apply

```bash
psql "$DATABASE_URL" -f src/db/postgres/migrations2/004_add_analytics_module.up.sql
# rollback
psql "$DATABASE_URL" -f src/db/postgres/migrations2/004_add_analytics_module.down.sql
```

## Tests

`test/unit/modules/event-analytics.test.ts` — query-builder parameterization +
table allow-list, waterfall tree (nesting/orphans/cycles), Apdex, time-range
resolution, CSV escaping:

```bash
npx vitest run test/unit/modules/event-analytics.test.ts
```

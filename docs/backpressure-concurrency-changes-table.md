# Backpressure & Concurrency Refactor Changes

| Area | Before | After | Application Impact | Key Files |
|---|---|---|---|---|
| Request-path backpressure | API ingestion checked queue depth through an exact pending-job count. | API ingestion reads `backpressure_gauge` with a short local cache. | Ingestion requests avoid expensive queue scans during load and make faster accept/shed decisions. | `src/modules/ingestion/service.ts`, `src/lib/gauge.ts` |
| Queue pressure source of truth | Queue pressure was derived directly from `ingestion_jobs` count calls. | Queue pressure is stored in the single-row `backpressure_gauge` table. | A shared database-backed gauge becomes the cross-process source of truth for API and worker backpressure state. | `src/db/postgres/migrations2/018_backpressure_gauge.up.sql`, `src/lib/gauge.ts` |
| Worker gauge updates | Workers processed jobs but did not publish queue pressure state. | Workers update `backpressure_gauge` after completed batches. | API nodes can make pressure decisions without querying the queue table directly. | `src/modules/ingestion/queue/pg-queue-worker.ts`, `src/modules/ingestion/workers/worker-registry.ts` |
| Queue depth metrics | Worker metrics used an exact queue pending-depth count. | Worker metrics read `queue.pending_depth` and gauge age from `backpressure_gauge`. | Operational metrics stay aligned with the same gauge used for readiness and backpressure. | `src/modules/ingestion/workers/worker-registry.ts` |
| Exact pending count | Exact `pendingDepth()` was available and used on request/health paths. | Exact `pendingDepth()` remains only as an admin/debug helper; request paths no longer call it. | Reduces database load under traffic spikes while preserving an exact helper for operator use. | `src/modules/ingestion/queue/pg-queue.ts` |
| Readiness checks | Existing health routes included broader dependencies and did not validate gauge freshness. | New `/health/live` and `/health/ready` endpoints were added. Readiness checks Postgres, gauge freshness, and max queue depth. | Load balancers can remove an instance when gauge data is stale or queue pressure is too high. | `src/app.ts`, `src/lib/health.ts` |
| Liveness checks | Liveness depended on existing app health behavior. | `/health/live` returns a lightweight process liveness response. | Supervisors can distinguish process-alive from traffic-ready state. | `src/lib/health.ts` |
| In-memory global limiters | `globalDbLimit`, `globalApiLimit`, and `globalRedisLimit` implied process-wide or cluster-wide protection. | Removed fake global DB limiter and renamed remaining limiters as local per-process limiters. | Prevents incorrect assumptions about cross-process concurrency control. | `src/lib/concurrency/limiters.ts` |
| Batching behavior | Batch processor handled chunks sequentially, creating serial barriers between chunks. | Batch processor uses `p-map` with bounded concurrency. | Large batch work can stream through the configured concurrency instead of waiting for each chunk boundary. | `src/lib/concurrency/batching.ts`, `package.json`, `package-lock.json` |
| PgBoss pool sizing | PgBoss pool size was hardcoded. | PgBoss pool size and connection timeout are environment-driven. | Queue infrastructure can be tuned per environment without code changes. | `src/lib/pgboss.ts`, `src/config/env.ts` |
| Ingestion worker DB pool | Worker pool idle and connection timeouts were hardcoded. | Worker pool timeout values come from env vars. | Production pool behavior can be tuned for managed Postgres/load-balancer behavior. | `src/workers/ingestion-worker-main.ts`, `src/config/env.ts` |
| Environment configuration | Backpressure gauge and local limiter tunables were not defined in the env schema. | Added env schema entries for gauge age, queue depth, gauge update interval, local limiter concurrency, and ingestion DB timeouts. | Startup validates all new operational knobs and supplies safe defaults. | `src/config/env.ts` |
| Removed code | `src/lib/concurrency/backpressure.ts` implemented obsolete in-memory request backpressure. | File deleted. | Removes misleading middleware and prevents future use of non-enterprise backpressure logic. | `src/lib/concurrency/backpressure.ts` |
| Database migration | No `backpressure_gauge` table existed. | Added up/down migration for `backpressure_gauge`. | Deployments must run migrations before relying on `/health/ready` and gauge-based backpressure. | `src/db/postgres/migrations2/018_backpressure_gauge.up.sql`, `src/db/postgres/migrations2/018_backpressure_gauge.down.sql` |
| Build output | Source changes were not compiled. | `npm run build` completed successfully and updated `dist/` output. | Runtime JS artifacts now reflect the TypeScript source changes. | `dist/**` |

## New Environment Variables

| Variable | Default | Purpose |
|---|---:|---|
| `INGESTION_DB_IDLE_TIMEOUT_MS` | `30000` | Idle timeout for the dedicated ingestion worker Postgres pool. |
| `INGESTION_DB_CONNECTION_TIMEOUT_MS` | `5000` | Connection acquisition timeout for ingestion worker and PgBoss pools. |
| `MAX_QUEUE_DEPTH` | `50000` | Readiness fails when gauge depth is above this value. |
| `MAX_GAUGE_AGE_MS` | `10000` | Readiness fails when gauge data is older than this threshold. |
| `GAUGE_UPDATE_INTERVAL_BATCHES` | `1` | Controls how often workers refresh the gauge after completed batches. |
| `API_MAX_CONCURRENCY` | `20` | Local per-process API limiter concurrency. |
| `REDIS_MAX_CONCURRENCY` | `100` | Local per-process Redis limiter concurrency. |

## Verification

| Check | Result |
|---|---|
| TypeScript build | `npm run build` passes. |
| Old backpressure symbols | No remaining `BackpressureTracker`, `globalDbLimit`, `globalApiLimit`, or `globalRedisLimit` references in `src`. |
| Request-path queue count | No call sites remain for `queue.pendingDepth()` in ingestion request or health paths. |
| New changed code `SELECT *` scan | No `SELECT *` was introduced in the new backpressure/gauge/health/concurrency changes. |

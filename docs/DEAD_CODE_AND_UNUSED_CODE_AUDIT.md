# Comprehensive Codebase Audit: Dead, Unreferenced & Unusable Code

**Target Project:** Pulsiv SaaS Backend (`pulse`)  
**Audit Scope:** Full codebase scan across `src/`, `package.json`, `scripts/`, `scratch/`, and `database/` using static graph reachability, AST symbol analysis, and dependency cross-referencing.  
**Date:** September 2026  

---

## Executive Summary

| Category | Count / Volume | Description |
| :--- | :--- | :--- |
| **1. 0-Byte Empty Files** | **8 files** | Completely empty `.ts` files on disk with zero bytes. |
| **2. Empty Placeholder Comment Files** | **8 files** | Files containing no executable code, only placeholder/TODO comments. |
| **3. Deprecated & Superseded Shims** | **5 files** | Code preserved for migrations that has been replaced (e.g. `pg-boss` shim, legacy telemetry writer, old custom queue). |
| **4. Unwired & Dead Feature Modules** | **31 files** | Entire submodules (e.g., `webhooks`, `billing/jobs`, legacy workers) never loaded by `app.ts` or any worker. |
| **5. Unused Dependencies** | **11 packages** | Production npm packages installed in `package.json` that are never imported anywhere in runtime code. |
| **6. Scratch & Obsolete Scripts** | **28 files** | Temporary one-off refactor scripts in `scratch/` and abandoned migration scripts. |
| **7. Dead In-Memory / Test-Only Code** | **4 files** | Production files only imported by unit tests and never wired into the runtime engine. |

---

## 1. 0-Byte Empty Files (Completely Unusable)
These files exist on disk with exactly `0 bytes` and contain no code or exports:

1. [`pulse/src/config/clickhouse.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/config/clickhouse.ts) — 0 bytes. Abandoned ClickHouse config.
2. [`pulse/src/config/queue.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/config/queue.ts) — 0 bytes. Unused queue config stub.
3. [`pulse/src/config/security.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/config/security.ts) — 0 bytes. Unused security config stub.
4. [`pulse/src/modules/webhooks/types.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/webhooks/types.ts) — 0 bytes. Empty webhooks types file.
5. [`pulse/src/modules/webhooks/webhooks.module.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/webhooks/webhooks.module.ts) — 0 bytes. Empty Fastify module file.
6. [`pulse/src/shared/types/api.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/shared/types/api.ts) — 0 bytes. Empty types file.
7. [`pulse/src/shared/utils/hashing.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/shared/utils/hashing.ts) — 0 bytes. Empty hashing utils file.
8. [`pulse/src/shared/utils/validation.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/shared/utils/validation.ts) — 0 bytes. Empty validation utils file.

---

## 2. Empty Placeholder Comment Files (0 Executable Code)
These files contain only multi-line docstring comments describing future intentions, with zero functions, classes, or exports:

1. [`pulse/src/modules/webhooks/routes.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/webhooks/routes.ts) — *"Webhook routes placeholder. No webhook management endpoints are currently implemented here."*
2. [`pulse/src/modules/webhooks/sender.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/webhooks/sender.ts) — *"Webhook sender placeholder. No outbound delivery logic is currently implemented here."*
3. [`pulse/src/modules/webhooks/signer.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/webhooks/signer.ts) — *"Webhook signer placeholder. No signing helper is currently implemented here."*
4. [`pulse/src/modules/webhooks/repository.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/webhooks/repository.ts) — *"Webhook repository placeholder. No webhook persistence logic is currently implemented here."*
5. [`pulse/src/shared/workers/alerting.processor.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/shared/workers/alerting.processor.ts) — *"Alerting worker placeholder. No BullMQ processor is implemented here yet."*
6. [`pulse/src/shared/workers/analysis.processor.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/shared/workers/analysis.processor.ts) — *"Analysis worker placeholder. No BullMQ processor is implemented here yet."*
7. [`pulse/src/shared/workers/retention.processor.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/shared/workers/retention.processor.ts) — *"Retention worker placeholder. No BullMQ processor is implemented here yet."*
8. [`pulse/src/shared/workers/billing.processor.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/shared/workers/billing.processor.ts) — *"Billing worker notes... Billing scheduling now lives in src/modules/billing/queue.ts via pg-boss..."*

---

## 3. Deprecated & Superseded Legacy Code
Files and shims that were rendered obsolete by architectural upgrades (e.g., the Supabase PGMQ migration or the `events_*` telemetry rewrite):

1. [`pulse/src/lib/pgboss.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/lib/pgboss.ts):
   - Explicitly marked: `DEPRECATED: pg-boss has been migrated to Supabase PGMQ (src/lib/pgmq.ts). This module is kept as a no-op / compatibility bridge.`
   - Contains fake mock methods: `work: async () => {}`, `startPgBoss: noop`, `stopPgBoss: noop`.
2. [`pulse/src/modules/ingestion/pipeline/telemetry-writer.legacy.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/ingestion/pipeline/telemetry-writer.legacy.ts):
   - Explicitly marked: `LEGACY — DISABLED. RETAINED FOR REFERENCE ONLY. DO NOT WIRE.`
   - Superseded by `telemetry-writer.ts`. 193 lines of dead code writing to defunct tables.
3. [`pulse/src/shared/workers/index.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/shared/workers/index.ts):
   - Wires up the old pre-PGMQ `PgQueueWorker` and `createIngestionJobHandler`. Never imported by PM2 or any active worker entrypoint.
4. [`pulse/src/modules/ingestion/queue/pg-queue.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/ingestion/queue/pg-queue.ts) & [`pg-queue-worker.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/ingestion/queue/pg-queue-worker.ts):
   - Custom PostgreSQL table queue written before adopting Supabase PGMQ (`src/lib/pgmq.ts`). Fully superseded.
5. [`pulse/src/modules/ingestion/logging/log-database.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/ingestion/logging/log-database.ts) & [`admin-logger.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/ingestion/logging/admin-logger.ts):
   - Old TimescaleDB connection and buffering logger (`TIMESCALEDB_URL`). Unused and replaced by Supabase PostgreSQL logging.

---

## 4. Unwired & Dead Feature Modules (Zero Inflow)
Subsystems that exist in the codebase but are completely disconnected from `app.ts` and worker processes:

### A. The 18 Standalone Billing Job Definition Wrappers
In `pulse/src/modules/billing/jobs/`:
Every one of these 18 files consists solely of:
`export const <name> = billingJobDefinitions.find((job) => job.key === '<key>');`
They are completely unimported because `definitions.ts` and `queue.ts` directly iterate over `billingJobDefinitions`:
- `addon-expiration.job.ts`
- `ai-credit-reset.job.ts`
- `billing-audit-archive.job.ts`
- `billing-metrics.job.ts`
- `coupon-expiration.job.ts`
- `data-reconciliation.job.ts`
- `entitlement-refresh.job.ts`
- `feature-override-expiration.job.ts`
- `invoice-generation.job.ts`
- `invoice-reminder.job.ts`
- `partition-cleanup.job.ts`
- `partition-creator.job.ts`
- `payment-reconciliation.job.ts`
- `payment-sync.job.ts`
- `subscription-renewal.job.ts`
- `trial-expiration.job.ts`
- `usage-aggregation.job.ts`
- `usage-anomaly.job.ts`
- `usage-rollover.job.ts`
- `webhook-dead-letter.job.ts`
- `webhook-retry.job.ts`

### B. Unused Internal Utilities & Middleware
- [`pulse/src/shared/middleware/rate-limit.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/shared/middleware/rate-limit.ts) — Standalone Redis rate limiter helper; never hooked into Fastify routes.
- [`pulse/src/shared/middleware/timeout.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/shared/middleware/timeout.ts) — Standalone request timeout hook; never registered in `app.ts`.
- [`pulse/src/shared/schemas/response.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/shared/schemas/response.ts) — Standalone Fastify response schemas; never referenced by route schemas.
- [`pulse/src/lib/concurrency/batching.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/lib/concurrency/batching.ts) & [`limiters.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/lib/concurrency/limiters.ts) — `chunkArray` and `processInBatches` helpers; never imported.
- [`pulse/src/lib/supabase.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/lib/supabase.ts) — `getSupabaseClient()` and `getSupabaseAdminClient()` JS client wrappers; unused (the backend connects via `pg.Pool` directly).
- [`pulse/src/modules/ingestion/rate-limiter.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/ingestion/rate-limiter.ts) — `TokenBucketRateLimiter`; unimported by the ingestion service or gateway.
- [`pulse/src/db/redis/cache.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/db/redis/cache.ts) — Superseded by `src/db/redis/lookup-cache.ts`.

---

## 5. Dead Dependencies in `package.json`
Heavy npm packages installed in `node_modules` that are never imported anywhere in application source code (`src/`):

| Package Name | Category | Status in Codebase |
| :--- | :--- | :--- |
| **`bullmq`** (`^5.73.0`) | `dependencies` | **100% Dead.** Only appears as a string literal inside instrumentation key lists (e.g. `'bullmq'`). The library is never imported. |
| **`@clickhouse/client`** (`^1.18.2`) | `dependencies` | **100% Dead.** Never imported anywhere in `src/`, `test/`, or `scripts/`. ClickHouse was abandoned. |
| **`@testcontainers/clickhouse`** (`^11.13.0`) | `devDependencies` | **100% Dead.** Dev container for ClickHouse; never imported. |
| **`@fastify/rate-limit`** (`^11.2.0`) | `dependencies` | **100% Dead.** Never imported in `src/`. Fastify does not register it. |
| **`@fastify/swagger`** (`^9.8.1`) | `dependencies` | **100% Dead.** Never imported in `src/app.ts` or routes. |
| **`@fastify/swagger-ui`** (`^6.1.1`) | `dependencies` | **100% Dead.** Never imported in `src/app.ts`. |
| **`@supabase/server`** (`^1.5.2`) | `dependencies` | **100% Dead.** Never imported in `src/`. |
| **`@supabase/ssr`** (`^0.12.5`) | `dependencies` | **100% Dead.** SSR package; never imported in `src/`. |
| **`opossum`** (`^9.0.0`) | `dependencies` | **100% Dead.** Circuit breaker library; never imported anywhere in `src/` or `test/`. |
| **`passport`** (`^0.7.0`) | `dependencies` | **100% Dead.** Only `@fastify/passport` is used; standard Express `passport` is unused. |
| **`ts-morph`** (`^28.0.0`) | `dependencies` | **Misclassified.** Only used in offline dev scripts (`scripts/ast_analyze.ts`); should not be a runtime dependency. |

---

## 6. Scratch & Obsolete Scripts
1. **The `pulse/scratch/` directory (22 files):**
   - Temporary CJS scripts used during past AST splits and refactors (`split.cjs`, `fix-imports.cjs`, `analyzer.cjs`, `gen-alerting-facade.cjs`, etc.). None are used by the app or PM2.
2. **Obsolete scripts in `pulse/scripts/`:**
   - `scripts/migrate-clickhouse.ts`: Abandoned database migration.
   - `scripts/rebuild-ingest-pgboss-queues.ts`: Obsolete `pg-boss` queue rebuild script.
   - `scripts/undo_ai_response.cjs`, `scripts/fix_telemetry_writer.cjs`, `scripts/test_errors_fix.ts`: One-off scratch scripts.

---

## 7. Test-Only Production Files
Production files in `src/` that are only imported by their corresponding unit tests and never participate in the live application or workers:
- [`pulse/src/modules/projects/alerts/thresholds/threshold.evaluator.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/alerts/thresholds/threshold.evaluator.ts) (Tested by `test/unit/modules/project-alert-thresholds.test.ts`)
- [`pulse/src/modules/alerting/preferences/preferences.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/preferences/preferences.ts) (Tested by `test/unit/alerting-preferences-correlation.test.ts`)
- [`pulse/src/modules/alerting/evaluation/metric-registry.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/evaluation/metric-registry.ts) (Tested by `test/unit/alerting-metric-registry.test.ts`)
- [`pulse/src/modules/alerting/entitlements/guard.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/entitlements/guard.ts) (Tested by `test/unit/alerting-entitlements.test.ts`)

---

## 8. Obsolete Backpressure Gauge Table Reference
- In [`pulse/src/lib/gauge.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/lib/gauge.ts#L28-L32), the health check endpoint `/health/ready` executes:
  ```sql
  SELECT COUNT(*)::bigint AS pending_depth
  FROM pgboss.job
  WHERE name LIKE 'ingest.%' AND state IN ('created', 'retry')
  ```
  Since the application migrated to Supabase PGMQ (`ingest_*` queues), `pgboss.job` is no longer active for ingestion jobs. The true queue depth metric is now provided by `ingestQueueDepth()` in `ingest-queues.ts` querying `pgmq.metricsAll()`.

---

## 9. Remediation & Execution Audit Log (Executed & Verified)

All recommended dead code removals and health check modernizations have been executed and verified against the live environment:

1. **46+ Dead and Placeholder Files Removed:**
   - Deleted all 8 zero-byte empty files (`src/config/clickhouse.ts`, `src/config/queue.ts`, `src/config/security.ts`, `src/shared/types/api.ts`, `src/shared/utils/hashing.ts`, `src/shared/utils/validation.ts`, `src/modules/webhooks/types.ts`, `src/modules/webhooks/webhooks.module.ts`).
   - Deleted all 8 comment-only placeholder files (entire `src/modules/webhooks/` directory, legacy processors in `src/shared/workers/`).
   - Deleted all 18 redundant 1-line billing job stubs in `src/modules/billing/jobs/`.
   - Deleted legacy/superseded files (`telemetry-writer.legacy.ts`, `pg-queue.ts`, `pg-queue-worker.ts`, `ingestion-job-handler.ts`, `log-database.ts`, `admin-logger.ts`, `rate-limiter.ts`, `db/redis/cache.ts`, `lib/supabase.ts`, `lib/concurrency/batching.ts`, `lib/concurrency/limiters.ts`, `shared/middleware/rate-limit.ts`, `shared/middleware/timeout.ts`, `shared/schemas/response.ts`).
   - Cleaned all 22 scratch migration scripts in `pulse/scratch/`.
   - Cleaned obsolete migration scripts (`scripts/migrate-clickhouse.ts`, `scripts/rebuild-ingest-pgboss-queues.ts`).

2. **Package Cleanup (`package.json`):**
   - Removed unused runtime dependencies: `bullmq`, `@clickhouse/client`, `@fastify/rate-limit`, `@fastify/swagger`, `@fastify/swagger-ui`, `@supabase/server`, `@supabase/ssr`, `opossum`, `passport`.
   - Removed devDependency: `@testcontainers/clickhouse`.
   - Moved `ts-morph` to `devDependencies`.

3. **Modernized Backpressure Gauge (`src/lib/gauge.ts`):**
   - Rewired `BackpressureGauge.read()` from defunct `pgboss.job` to live Supabase PGMQ queue metrics:
     ```sql
     SELECT COALESCE(SUM(queue_length), 0)::bigint AS pending_depth
     FROM pgmq.metrics_all()
     WHERE queue_name LIKE 'ingest_%' OR queue_name LIKE 'ingest.%'
     ```

4. **Verification & Testing:**
   - `npx tsc --noEmit`: 0 errors.
   - `npm run build`: Clean compilation into `dist/`.
   - Live backpressure gauge probe: Successfully queries live Supabase database over port 6543, returns active queue depth (`379` items).
   - Fastify `/health/live`: HTTP 200 OK (`status: "alive"`).
   - Fastify `/health/ready`: HTTP 200 OK (`status: "ready"`, `depth: 379`).
   - Automated unit tests: 43/43 tests passed.


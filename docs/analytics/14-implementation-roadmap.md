# Implementation Roadmap

Ordered, verifiable waves. Each wave lists exit criteria that can be checked with
a command or a file read. Nothing in a later wave depends on a frontend change.

---

## Wave 0 — Schema foundation

| Item | Artifact |
| --- | --- |
| Rollup + control tables | `database/migrations/logdb/04_analytics/003_analytics_engine_rollups.up.sql` |
| Partition helper + `events_*` watermark indexes | `database/migrations/logdb/04_analytics/004_analytics_engine_partitions.up.sql` |
| Freeze comments on legacy analytics tables | same migration (`COMMENT ON TABLE … IS 'FROZEN: …'`) |

Exit criteria
- `npm run db:migrate:logdb` applies both files with `failed: 0`.
- `test/integration/analytics-engine-migrations.test.ts` asserts every table in
  `07-rollup-tables.md` exists with the documented PK and indexes.
- `analytics_engine_ensure_partitions(7)` returns > 0 and is idempotent on a
  second call.

## Wave 1 — Engine core

`src/modules/analytics-engine/{types,windows,hll,histogram,watermark.repository,rollup-writer,registry}.ts`

Exit criteria
- `test/unit/analytics-engine-windows.test.ts`: bucket math, window auto-selection
  from `from`/`to`, grace handling.
- `test/unit/analytics-engine-hll.test.ts`: encode/merge/estimate within 2 % on
  100 k distinct values; merge is commutative and associative.
- `test/unit/analytics-engine-histogram.test.ts`: percentile recovery within one
  bucket width; merge is additive.
- `test/unit/analytics-engine-rollup-writer.test.ts`: generated SQL is a single
  `INSERT … ON CONFLICT DO UPDATE`; replay produces identical values.

## Wave 2 — P0 workers

`requests`, `endpoints`, `services`, `errors`, `logs`, `traces`, `spans`,
plus `compaction`, `retention`, `partitions`, `dispatch`.

Exit criteria
- `test/unit/analytics-engine-workers.test.ts`: for each worker, the SQL reads
  only its declared `sourceTables` and writes only its declared `outputTables`.
- Idempotency test: running a worker twice over the same window yields identical
  rollup rows.
- Watermark test: a failing run does not advance the watermark.

## Wave 3 — Dedicated process

`src/shared/workers/analytics-worker-main.ts`, PM2 app, health + metrics server,
`ANALYTICS_*` env additions in `src/config/env.ts` and `.env.example`.

Exit criteria
- `PROCESS_ROLE=analytics tsx src/shared/workers/analytics-worker-main.ts` starts,
  logs each registered worker, and emits `ready`.
- `GET :9301/health` returns the documented shape; `GET :9301/metrics` returns
  Prometheus text.
- `test/unit/analytics-worker-process.test.ts` asserts the entrypoint registers
  exactly the registry's workers and no ingestion queue.
- Grep-style assertion in the same test: the ingestion entrypoint imports nothing
  from `analytics-engine`.

## Wave 4 — Read layer + API

`read/*.repository.ts`, `api/*.routes.ts`, `analytics-engine.module.ts`, wired in
`src/app.ts` under `/analytics/v2`.

Exit criteria
- `test/unit/analytics-engine-read.test.ts` asserts no repository SQL contains
  `FROM events_` except the declared raw-detail methods.
- `test/unit/analytics-engine-api.test.ts` asserts the envelope
  (`meta.freshness`, `meta.window`, `cards[].direction`, zero-filled series) for a
  representative route per group.
- `test/unit/analytics-engine-contract.test.ts` asserts every route in
  `08-dashboard-api-contracts.md` §3 is registered.

## Wave 5 — Remaining workers

`metrics`, `runtime`, `crons`, `profiles`, `replays`, `sessions`, `geo`, `sdk`,
`releases`, `slo`, `security`, `usage`, `alerts`, `ai`, `anomalies`, `health`.

Exit criteria: same per-worker tests as Wave 2; `capabilities` flags reported for
`slo` and `deployments`.

## Wave 6 — Frontend migration

Per `02-dummy-data-audit.md` §3, module by module. New client:
`pulsiv_fe/src/modules/analytics/api/*` + typed hooks.

Exit criteria
- No file under `pulsiv_fe/src/pages/**` or `src/modules/**` imports
  `@/hooks/useDummyData` or `@/lib/dummy-data`.
- `seededSeries`, `countryForIp`, `percentile`, `avg`, `bucketCounts`, `errorRate`,
  `groupBy`, `uniqueBy` are deleted from `pages/dashboards/lib.ts`.
- ESLint rules added: `no-restricted-imports` for the fixture modules,
  `no-restricted-syntax` for `Math.random()` under `src/pages/**`.
- `npx tsc --noEmit` passes in the frontend.

## Wave 7 — Cleanup (requires explicit approval)

| Action | Risk | Approval |
| --- | --- | --- |
| Remove the 3 legacy `analytics.*` jobs from `src/shared/workers/main.ts` | low (they write tables nothing reads) | maintainer |
| Delete the v1 `/analytics/*` routes and `src/modules/analytics/**` | medium (external consumers?) | maintainer |
| `DROP TABLE` the frozen legacy analytics tables | **destructive** | maintainer, separate migration |
| `DROP TABLE` orphaned pre-canonical telemetry tables (`errors`, `logs`, `requests`, `spans`, `traces`, `metrics`, `messages`, `profiles`, `replays`, `cron_checkins`, `error_groups`) and legacy usage rollups | **destructive, irreversible** | maintainer, separate migration, backup first |

## Wave 8 — Future expansion (documented, not built)

1. `deployments` signal → DORA metrics.
2. Platform self-telemetry store → internal ops dashboard.
3. `analytics.backfill` admin job for historical replay.
4. Org-local day boundaries for `1d` rollups.
5. Custom-metric schema registry with unit/type enforcement.
6. Read replica routing for analytics reads.
7. Anomaly detection upgrade from 3σ to seasonal decomposition.

---

## Dependency order

```
Wave 0 ─► Wave 1 ─► Wave 2 ─► Wave 3 ─► Wave 4 ─► Wave 6 ─► Wave 7
                        └──► Wave 5 ──────┘
```
Wave 4 can ship before Wave 5; routes whose workers are not yet registered return
`meta.freshness.stale = true` with empty payloads rather than errors, so the
frontend migration can begin as soon as the P0 routes are live.

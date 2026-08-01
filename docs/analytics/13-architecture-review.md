# Phase 20 — Architecture Quality Review

Review of the design in `00`, `06`, `07`, `08` before implementation. Ratings are
justified, not decorative, and every weakness has a decision attached.

---

## 1. Ratings

| Dimension | Score | Justification |
| --- | --- | --- |
| Enterprise readiness | 8 / 10 | Dedicated process, watermarks, idempotency, health/metrics, retention, partitioning, single-writer ownership, documented contracts. Held back by: no multi-region story, no schema registry for custom metrics, SLO definitions still to be added to the control plane. |
| Scalability | 8 / 10 | Per-org fan-out with `SKIP LOCKED`, bounded batches, top-K cardinality guards, HLL/histogram merges, tiered windows. Held back by: single Log DB instance is the ceiling; per-minute entity rollups for very high-cardinality routes remain the heaviest write path. |
| Performance | 9 / 10 | Dashboard reads become single-table indexed range scans on pre-aggregated rows instead of 10-table unions with `PERCENTILE_CONT`. Expected p95 read latency < 50 ms vs seconds today. |
| Observability | 9 / 10 | Per-worker watermark lag, run ledger, Prometheus metrics, freshness in every API response, deep link from any widget to its source events. Missing: tracing of the analytics workers themselves. |
| Developer experience | 8 / 10 | Declarative worker registry, one file per worker, shared rollup writer, catalog-driven metric keys, contract tests. Cost: 32 new tables and a big surface to learn. |
| Operational simplicity | 7 / 10 | One more process to run and one more migration tree to apply. Mitigated by: no new infrastructure (no Redis, no ClickHouse, no Kafka), PM2 wiring identical to existing workers, feature flag to disable the engine wholesale. |
| Future extensibility | 9 / 10 | Adding a metric = add a column + catalog entry; adding a signal = add a worker file + registry entry + rollup table; window tiers are generic. |

## 2. Correctness review

| Concern | Verdict |
| --- | --- |
| Late-arriving events | Handled: progress tracked on `ingested_at`, buckets grouped on event time, and a configurable grace window forces recompute of recently-touched buckets. |
| Duplicate job execution | Safe: whole-bucket recompute + `ON CONFLICT DO UPDATE` is idempotent. |
| Percentile accuracy after merge | Exact at 1m, bounded by histogram bucket width above it. Documented in the catalog (`Agg = HIST`). This is the standard trade-off (Prometheus, Datadog do the same); the alternative — storing raw latencies — defeats the purpose. |
| Distinct-count accuracy after merge | Exact at 1m, ≈0.8 % relative error above it via 2^14-register HLL. Documented per metric. |
| Timezone correctness | All buckets are UTC `timestamptz`; the client renders locally. Day boundaries for `1d` are UTC — documented, and org-local day boundaries are listed as future work. |
| Multi-tenant isolation | Every rollup PK starts with `organization_id`; every read repository takes `orgId` from the authenticated context; project routes keep `requireProjectMembership`. |
| Environment semantics | `environment` is the same free-form string contract as `events_*`, plus the `__all__` sentinel for cross-environment aggregates. Validation regex reused from v1. |
| PII | Rollups store `client_ip_hash`, never raw IPs; `user_id` appears only inside HLL sketches and exact counts, never as an entity key except where the UI already shows it (top-users lists are excluded from v1). |
| Sentinel-value collisions | `project_id = 000…0` and `environment = '__all__'` cannot collide with real values (UUID zero is never issued; `__all__` fails the environment regex, so ingestion cannot produce it). |

## 3. Weaknesses identified before implementation

| # | Weakness | Decision |
| --- | --- | --- |
| W1 | 32 new tables × window tiers is a large schema addition | accept; tables are generated from two shared templates in one migration, and the storage estimate (~0.7 GB/busy project) is 3 orders of magnitude below raw-scan cost |
| W2 | Per-minute entity rollups can explode with pathological cardinality | top-K 1 000 per bucket + `__other__` row + `metrics.series_cardinality` warning metric |
| W3 | HLL implemented in application code rather than a Postgres extension | accept; extension availability is not guaranteed in the target environment, and the sketch is written/merged only by the engine. Documented invariant: sketch format version byte is stored so the format can evolve |
| W4 | Rollup-on-rollup workers (`slo`, `health`, `anomalies`) can publish partial windows | they clamp their watermark to `min(input watermarks)` |
| W5 | `analytics_hourly_rollup` etc. remain in the schema unused | frozen with a comment; drop requires human approval (roadmap gate) |
| W6 | Legacy `analytics.*` pg-boss jobs still registered in the shared worker process | queue names differ (`analytics.rollup-hourly` vs `analytics.requests`), so there is no collision; removal is a documented cleanup step |
| W7 | The v1 `/analytics/*` API stays live during migration | acceptable; it keeps the frontend working. Removal is gated on the last consumer migrating |
| W8 | No backfill story for historical telemetry | add a `analytics.backfill` admin job that replays a bounded historical range per org, rate-limited; P2 |
| W9 | SLO definitions do not exist yet | `analytics.slo` no-ops when no definitions are present and reports `capabilities.slo = false` to the API |
| W10 | Partition maintenance depends on a function this work introduces | migration creates it; the boot sequence calls it before registering workers, and the call is not swallowed |
| W11 | Analytics workers add read load to the Log DB that competes with ingestion writes | bounded batches, `statement_timeout`, and a dedicated pool with a small `max` (default 4) so analytics cannot starve the writer pool |
| W12 | Frontend migration is the largest single risk (15 surfaces) | sequenced module-by-module in `02-dummy-data-audit.md` §3 with the fixtures kept until the last consumer moves |

## 4. Design alternatives considered and rejected

| Alternative | Why rejected |
| --- | --- |
| ClickHouse for rollups | adds infrastructure the stage explicitly avoids; `@clickhouse/client` is a dependency but no ClickHouse migration or config exists (`src/config/clickhouse.ts` is empty) |
| Postgres materialised views | no incremental refresh; `REFRESH MATERIALIZED VIEW CONCURRENTLY` rescans everything |
| TimescaleDB continuous aggregates | extension not guaranteed; would couple the design to a specific Postgres distribution |
| Generic EAV rollup (extend `analytics_hourly_rollup`) | cannot carry percentile histograms or sketches; every read becomes a `dimensions @> …` GIN scan |
| One "analytics" worker with a switch statement | forbidden by the prompt and by operational sense (no independent scaling, one poison job stalls everything) |
| Computing rollups inside the ingestion worker | forbidden by the prompt; couples dashboard freshness to ingest throughput |
| Streaming (Kafka/Debezium) | no message bus in the stack; pg-boss + watermarks achieve the required 30 s freshness |
| Trigger-based incremental counters on `events_*` | write amplification on the hottest tables; violates ingestion isolation |

## 5. Pre-implementation checklist (all satisfied)

- [x] Every widget maps to exactly one rollup or one raw-detail read (§9 matrix)
- [x] Every rollup table has exactly one writing worker (§07 §4)
- [x] Every metric has exactly one definition (§10)
- [x] Every API route has a payload shape (§08)
- [x] Every worker has retry, idempotency, health, and failure-recovery semantics (§06)
- [x] Ingestion isolation is stated and testable (§00 §3)
- [x] Log-DB-only reads are stated and testable (§00 §2)
- [x] Storage and cardinality bounded (§07 §5)
- [x] Dummy-data removal sequenced (§02 §3)
- [x] Known gaps have owners and priorities (§12)

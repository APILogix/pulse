# PostgreSQL Ingestion Audit & Engineering Action Plan

**System Target**: Pulse Ingestion Subsystem (`Fastify` Gateway, `pg-boss` Worker Registry, `EventProcessor`, `TelemetryWriter`, `PostgreSQL 16` Log DB)  
**Audit Standard**: Optimization Treadmill Framework (Append-Only Time-Series Telemetry on Postgres)  
**Document Purpose**: Definitive technical record of audit findings, architectural root causes, and explicit code/database engineering changes required to remediate ingestion bottlenecks.  
**Classification**: Audit & Engineering Action Plan (No code changes executed in this phase).

---

## 1. Executive Summary & Workload Classification

### 1.1 Audit Assessment
The Pulse ingestion engine is currently exhibiting transaction runtimes between **3.0s and 15.3s per batch**, queue wait times exceeding **6.6s**, and end-to-end event delays of **10s to 47s**.

The core breakdown is **not** an inherent limitation of PostgreSQL for time-series telemetry. Rather, the system is caught in classic relational antipatterns that convert an append-only time-series stream into an expensive mutating OLTP workload:
1. **Pseudo-Partitioning**: Tables are declared as range-partitioned on `occurred_at`, but route 100% of rows into a single `_default` partition. Partition pruning is impossible, and partition-drop retention cannot be executed.
2. **Error Ingestion Mutation & Double-Writing**: Error batches execute an $O(N)$ row-locking loop (`SELECT ... FOR UPDATE` on `error_groups`), followed by an immediate secondary `UPDATE events_errors` on rows just inserted. This produces a 100% dead-tuple ratio on wide rows (40 columns).
3. **Write Amplification & Random UUID B-Tree Splitting**: Raw event tables maintain up to 26 indexes per row with random `UUIDv4` primary keys. Inserts scatter across B-Tree leaf blocks, causing constant 50/50 page splits, cache eviction, and excessive WAL generation.
4. **Outbox Lock Contention**: A 3-part CTE unnesting 9 typed arrays into an unpartitioned global table (`alert_runtime_idempotency_keys`) inside the telemetry transaction creates 1.0s–2.1s stalls.
5. **Connection & Concurrency Sizing Mismatch**: 80 worker threads compete for 8–20 database connections, compounding transaction duration into multi-second queue head-of-line blocking.

---

### 1.2 Table Workload Scoring (Optimization Treadmill)

| Table | Trait 1 (High Freq Ingest) | Trait 2 (Time-Series Access) | Trait 3 (Append-Only) | Trait 4 (Long Retention) | Trait 5 (Same-Store SLA) | Trait 6 (Sustained Growth) | Score | Pattern Verdict |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **`events_spans`** | YES | YES | YES | YES | YES | YES | **6 / 6** | **IN PATTERN** |
| **`events_requests`** | YES | YES | YES | YES | YES | YES | **6 / 6** | **IN PATTERN** |
| **`events_logs`** | YES | YES | YES | YES | YES | YES | **6 / 6** | **IN PATTERN** |
| **`events_traces`** | YES | YES | YES | YES | YES | YES | **6 / 6** | **IN PATTERN** |
| **`events_errors`** | YES | YES | **NO\*** | YES | YES | YES | **5 / 6** | **IN PATTERN** |
| **`error_groups`** | NO | NO | NO | YES | YES | NO | **2 / 6** | **NOT IN PATTERN (OLTP)** |
| **`analytics_user_sessions`**| NO | NO | NO | YES | YES | NO | **2 / 6** | **NOT IN PATTERN (OLTP)** |
| **`telemetry_outbox`** | YES | NO | NO | NO | NO | NO | **1 / 6** | **NOT IN PATTERN (Queue)** |
| **`alert_runtime_idempotency_keys`**| YES | NO | NO | NO | NO | NO | **1 / 6** | **NOT IN PATTERN (Buffer)** |

*\*`events_errors` violates Trait 3 in code because `attachGroups()` executes a secondary UPDATE on newly inserted rows.*

---

## 2. Core Forensic Findings & Root Causes

### Finding 1: The Pseudo-Partitioning Trap (`events_*_default`)
* **Source Evidence**: [`database/logdbv2/migrations/000001_create_schema.up.sql`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/database/logdbv2/migrations/000001_create_schema.up.sql) and [`database/logdbv2/schema.sql`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/database/logdbv2/schema.sql).
* **Mechanism**: Every canonical table (`events_spans`, `events_requests`, etc.) defines `PARTITION BY RANGE (occurred_at)` but creates only one partition: `events_*_default PARTITION OF events_* DEFAULT;`.
* **Consequences**:
  1. PostgreSQL must evaluate partition routing during inserts and queries, but always resolves to the default table. Pruning cannot eliminate any data.
  2. In PostgreSQL, if data exists in `_default`, creating a new range partition whose bounds overlap existing rows throws:
     `ERROR: updated partition constraint for default partition "events_spans_default" would be violated by some row`.
  3. Retention cannot drop partitions. Old data can only be pruned via row-level `DELETE`, generating massive WAL, dead-tuple bloat, and vacuum stalls.

### Finding 2: Error Ingestion Mutation & Double-Writing ($3N+6$ Queries)
* **Source Evidence**: [`error.repository.ts:199`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/errors/repositories/error.repository.ts#L199), [`error-group.repo.ts:203`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/errors/repositories/error-group.repository.ts#L203), [`INGESTION_PERFORMANCE_FORENSIC_REPORT.md`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/docs/modules/ingestion/INGESTION_PERFORMANCE_FORENSIC_REPORT.md).
* **Mechanism**:
  1. `TelemetryWriter` bulk-inserts error rows with `error_group_id = NULL`.
  2. `ErrorGroupRepository` executes an $N$-iteration loop: `INSERT ... ON CONFLICT DO NOTHING`, followed by `SELECT * FROM error_groups FOR UPDATE`, followed by `UPDATE error_groups`.
  3. `ErrorRepository.attachGroups()` executes `UPDATE events_errors AS e SET error_group_id = v.group_id::uuid FROM (VALUES ...)`.
* **Consequences**:
  * 100% of newly inserted error rows immediately become dead tuples due to the secondary `UPDATE`.
  * Concurrent workers processing bursts of identical errors serialize behind `ExclusiveLock` on the same `error_groups` row, triggering `lock_timeout = 2000ms` and SQLSTATE `55P03` transaction crashes.

### Finding 3: Write Amplification & Random UUID B-Tree Degradation
* **Source Evidence**: [`schema/05_observability/005_create_events_spans.sql`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/database/logdbv2/schema/05_observability/005_create_events_spans.sql), [`schema/05_observability/002_create_events_errors.sql`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/database/logdbv2/schema/05_observability/002_create_events_errors.sql).
* **Mechanism**:
  * `events_errors` carries 26 indexes; `events_spans` carries 22 indexes across 67 columns.
  * Primary keys use random `UUIDv4` (`gen_random_uuid()`).
* **Consequences**:
  * Each insert forces 1 heap write plus 22–26 B-Tree / GIN updates.
  * Random UUIDs disperse inserts uniformly across the entire B-Tree key space instead of appending at the right-hand leaf edge, causing constant 50/50 page splits, destroying cache locality, and generating heavy Full Page Writes (FPW) in WAL.

### Finding 4: Global Lock Contention in Outbox CTE
* **Source Evidence**: [`telemetry-writer.ts:664`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/ingestion/pipeline/telemetry-writer.ts#L664), [`001_functions.sql:13-44`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/database/logdbv2/schema/15_functions/001_functions.sql#L13-L44).
* **Mechanism**:
  * `appendTelemetryOutbox()` runs a 3-part CTE unnesting 9 typed arrays into `alert_runtime_idempotency_keys` and `telemetry_outbox`.
  * `reserve_alert_runtime_idempotency()` performs active deletions (`DELETE FROM alert_runtime_idempotency_keys WHERE expires_at < NOW()`).
* **Consequences**:
  * Ingestion transactions contend for B-Tree page latches against background alert evaluators and cleaners on a non-partitioned global table, creating 1.0s–2.1s stalls on trivial 2-event batches.

### Finding 5: Concurrency Misalignment & Connection Starvation
* **Source Evidence**: [`src/config/env.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/config/env.ts), [`worker-registry.ts:199`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/ingestion/workers/worker-registry.ts#L199).
* **Mechanism**:
  * 10 typed queues $\times$ localConcurrency 2 $\times$ batch 4 = up to 80 active worker tasks.
  * `INGESTION_WRITE_POOL_SIZE = 20`, admission semaphore `INGESTION_WRITE_CONCURRENCY = 16`.
* **Consequences**:
  * When transactions take 3s–15s due to Findings 2, 3, and 4, the 16 write permits are pinned.
  * The remaining workers stall at `writeAdmission.acquire()`, backing up jobs in pg-boss with queue delays exceeding 6,600ms.

---

## 3. Required Backend Updates (`src/`)

### 3.1 Error Ingestion Refactoring (`src/modules/errors/`)
Eliminate the $O(N)$ query loop and remove the secondary update pass on `events_errors`.

1. **Pre-compute and Pre-aggregate in Node.js**:
   * Calculate error fingerprints in memory before opening the database transaction.
   * Group errors by `(project_id, fingerprint)` and sum their occurrences within the batch.
2. **Execute Single Set-Based CTE Upsert** in `ErrorGroupRepository.upsertGroupsBatch()`:
   * Replace the row-by-row `SELECT ... FOR UPDATE` with a single multi-row `INSERT ... ON CONFLICT (project_id, fingerprint) DO UPDATE` query returning `id, project_id, fingerprint`.
   * Eliminate `lockByFingerprint()`.
3. **Single-Pass Direct Insert** in `ErrorRepository.insertManyIfNew()`:
   * Map the resolved `error_group_id` into each event payload in Node.js before running the insert.
   * Insert into `events_errors` with `error_group_id` already populated.
4. **Delete `ErrorRepository.attachGroups()`**:
   * Completely remove the secondary `UPDATE events_errors AS e SET error_group_id = ...` query.
   * Result: Query count drops from $3N+6$ to **4 fixed queries** per batch; dead-tuple generation drops to 0.

### 3.2 Time-Ordered ID Generation at Gateway Boundary (`src/modules/ingestion/`)
Eliminate database sequence locks and B-Tree page fragmentation.

1. **Adopt UUIDv7 / ULID Generation in Node.js**:
   * In `event-normalizer.ts`, generate time-ordered sequential UUIDs (`uuidv7`) for `id` and `public_id` if omitted by the client.
2. **Pass Explicit Values to TelemetryWriter**:
   * Ensure `TelemetryWriter` supplies `public_id`, `created_at`, `ingested_at`, and `payload` explicitly on every row.
   * Prevents database fallback to `nextval('seq_pubid_*')` and avoids trigger row-serialization in `logdb_sync_typed_event_contract()`.

### 3.3 Outbox Decoupling (`src/modules/ingestion/pipeline/telemetry-writer.ts`)
Remove unpartitioned global table locks from the telemetry transaction hot path.

1. **Decouple Alert Outbox from Telemetry Transaction**:
   * Separate telemetry persistence (`events_*`) from alert outbox insertion (`telemetry_outbox`).
   * Append outbox events post-commit or buffer them via an in-memory queue/Redis stream.
2. **Eliminate 9-Array Custom Enum UNNEST**:
   * If outbox must be written in the same transaction, replace the complex CTE with a straightforward multi-row parameterized `INSERT INTO telemetry_outbox VALUES (...) ON CONFLICT DO NOTHING`.
   * Remove synchronous interaction with `alert_runtime_idempotency_keys` from the batch writer.

### 3.4 Worker Concurrency & Pool Realignment (`src/config/env.ts`)
Align queue polling to physical database write capacity.

1. **Pool Sizing Invariant**:
   * Enforce: `INGESTION_WRITE_POOL_SIZE >= INGESTION_WRITE_CONCURRENCY + 4`.
   * If `INGESTION_WRITE_CONCURRENCY = 16`, set `INGESTION_WRITE_POOL_SIZE = 24`.
2. **Worker Polling Bounding**:
   * Adjust `INGESTION_TYPE_WORKER_CONCURRENCY` and queue polling so total concurrent job attempts do not exceed `INGESTION_WRITE_CONCURRENCY * 1.5`.
   * Workers will not pull jobs from pg-boss only to block in Node.js semaphore queues.

### 3.5 Trace Processing Streamlining (`src/modules/ingestion/pipeline/telemetry-writer.ts`)
1. **Eliminate Payload Cloning on Span Derivation**:
   * In `writeTraceSpanTree()`, do not replicate the complete parent trace payload across child span rows.
   * Insert child spans using a direct columnar projection to minimize parameter bindings.

---

## 4. Required Database & Schema Updates (`database/logdbv2/`)

### 4.1 Migration Phase 1: True Daily Range Partitioning
Transition from the `_default` partition trap to physical rolling partitions.

1. **Pre-create Daily Child Partitions**:
   * Create an automated partition maintenance function `logdb_ensure_daily_partitions(target_table text, days_ahead int)`.
   * Pre-create daily partitions (e.g. `events_spans_y2026m10d06`) covering 7 days ahead.
2. **Default Partition Evacuation**:
   * Author a one-time migration script to move existing rows from `events_*_default` into their respective daily partitions.
   * Detach and drop `events_*_default` once empty, or keep an empty catch-all with alert monitoring to detect out-of-bounds writes.

### 4.2 Migration Phase 2: Index Pruning on Hot-Path Tables
Eliminate write amplification by matching the index cleanup executed on `events_requests` in migrations 025/028.

1. **Drop Broad JSONB GIN Indexes**:
   ```sql
   -- events_spans
   DROP INDEX IF EXISTS idx_events_spans_attributes_gin;
   DROP INDEX IF EXISTS idx_events_spans_metadata_gin;
   DROP INDEX IF EXISTS idx_events_spans_payload_gin;
   DROP INDEX IF EXISTS idx_events_spans_ai_response_gin;

   -- events_logs
   DROP INDEX IF EXISTS idx_events_logs_context_gin;
   DROP INDEX IF EXISTS idx_events_logs_tags_gin;
   DROP INDEX IF EXISTS idx_events_logs_attributes_gin;
   DROP INDEX IF EXISTS idx_events_logs_metadata_gin;
   DROP INDEX IF EXISTS idx_events_logs_payload_gin;
   DROP INDEX IF EXISTS idx_events_logs_ai_response_gin;

   -- events_errors
   DROP INDEX IF EXISTS idx_events_errors_context_gin;
   DROP INDEX IF EXISTS idx_events_errors_tags_gin;
   DROP INDEX IF EXISTS idx_events_errors_extra_gin;
   DROP INDEX IF EXISTS idx_events_errors_metadata_gin;
   DROP INDEX IF EXISTS idx_events_errors_payload_gin;
   DROP INDEX IF EXISTS idx_events_errors_ai_response_gin;
   ```
2. **Drop Low-Utility Secondary B-Trees**:
   * Drop composite indexes with zero production query scans:
     * `idx_events_spans_slow_db`
     * `idx_events_spans_db_collection`
     * `idx_events_spans_host_time`
     * `idx_events_spans_watermark`
     * `idx_events_logs_host_time`
     * `idx_events_logs_facility_time`
   * Retain strictly:
     * Primary Key `(id, occurred_at)`
     * Idempotency Unique `(organization_id, event_id, occurred_at)`
     * Core Query Path: `(organization_id, trace_id, occurred_at ASC)` for spans; `(organization_id, error_group_id, occurred_at DESC)` for errors.
     * BRIN Index: `USING BRIN (occurred_at)` for coarse time-window bounding.

### 4.3 Migration Phase 3: Transition to UUIDv7 Primary Keys
1. **Schema DDL Update**:
   * Change default UUID generation from `gen_random_uuid()` to PostgreSQL 17 / extension `uuid_generate_v7()` or supply `uuidv7` from application code.
   * Ensures new B-Tree leaf entries append at the right-hand edge, eliminating 50/50 page splits and drastically reducing WAL generation.

### 4.4 Migration Phase 4: Native Partition-Drop Retention Automation
1. **Implement `logdb_enforce_retention_partition_drop()`**:
   * Extend [`schema/15_functions/001_functions.sql`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/database/logdbv2/schema/15_functions/001_functions.sql) to inspect `events_*` child partitions.
   * Determine partitions where `range_to <= NOW() - retention_period`.
   * Execute:
     ```sql
     ALTER TABLE events_spans DETACH PARTITION events_spans_y2026m08d01 CONCURRENTLY;
     DROP TABLE events_spans_y2026m08d01;
     ```
   * Result: Instantaneous reclamation of disk storage; zero dead tuples; zero WAL generation.

### 4.5 Migration Phase 5: Fast-Path Trigger Bypass
1. **Contract Function Simplification**:
   * Since Node.js now guarantees `public_id`, `created_at`, and `payload`, update `trg_sync_typed_event_contract` to execute an instant `RETURN NEW` when fields are non-null.
   * Disable `BEFORE INSERT` triggers entirely on production environments where application normalization is verified by unit tests.

---

## 5. Technical Specification & Implementation Mapping

### 5.1 Error Ingestion Pipeline Refactoring

#### Before (Anti-Pattern):
```
Batch Ingest (N errors)
  │
  ├─► 1. INSERT INTO events_errors (..., error_group_id = NULL)
  │
  ├─► 2. Loop i = 1 to N:
  │       ├─► INSERT INTO error_groups ... ON CONFLICT DO NOTHING
  │       ├─► SELECT * FROM error_groups WHERE ... FOR UPDATE (Row Lock Contention)
  │       └─► UPDATE error_groups SET occurrence_count+1, ... (Tuple Churn)
  │
  ├─► 3. UPDATE events_errors AS e SET error_group_id = ... (Dead-Tuple Generation)
  │
  └─► 4. appendTelemetryOutbox (CTE UNNEST 9 arrays, Global Table Locks)
```

#### After (Target Architecture):
```
Batch Ingest (N errors)
  │
  ├─► 1. Node.js In-Memory Pre-Processing:
  │       ├─ Generate UUIDv7 event IDs
  │       ├─ Compute error fingerprints
  │       └─ Group & aggregate incoming counts per (project_id, fingerprint)
  │
  ├─► 2. Single Set-Based CTE Upsert:
  │       WITH incoming AS (SELECT * FROM UNNEST($fingerprints, $projects, $counts)),
  │       upserted AS (
  │         INSERT INTO error_groups (...) SELECT ... FROM incoming
  │         ON CONFLICT (project_id, fingerprint) DO UPDATE
  │         SET occurrence_count = error_groups.occurrence_count + EXCLUDED.occurrence_count
  │         RETURNING id, fingerprint, project_id
  │       )
  │       SELECT id, fingerprint, project_id FROM upserted;
  │
  ├─► 3. Single-Pass Bulk Insert (events_errors):
  │       INSERT INTO events_errors (..., error_group_id, public_id, occurred_at)
  │       VALUES ($1, ..., precomputed_group_id, precomputed_uuidv7, occurred_at)
  │       ON CONFLICT (organization_id, event_id, occurred_at) DO NOTHING;
  │       (Zero Secondary UPDATE, Zero Dead Tuples)
  │
  └─► 4. COMMIT & Asynchronous Post-Commit Outbox Dispatch
```

---

### 5.2 Summary of Target Metrics

| Metric | Current State | Target Post-Remediation | Impact Factor |
| :--- | :---: | :---: | :---: |
| **Error Batch Queries ($N=10$)** | 36 queries | **4 queries** | **9x query reduction** |
| **Error Insert Latency** | 9,400ms – 12,425ms | **< 300ms** | **30x–40x speedup** |
| **Span 200 Batch Insert Latency** | 6,287ms | **< 250ms** | **25x speedup** |
| **Commit Latency (`commitMs`)** | 1,579ms – 2,027ms | **< 40ms** | **40x–50x speedup** |
| **Queue Wait Time (`queueWaitMs`)** | 6,118ms – 6,612ms | **< 100ms** | **60x speedup** |
| **Dead Tuples on `events_errors`** | 100% of inserted rows | **0%** | **Eliminates heap bloat** |
| **Retention Operation Cost** | Multi-minute `DELETE` + WAL | **< 50ms `DROP PARTITION`** | **Zero WAL / zero bloat** |

---

## 6. Engineering Implementation Checklist

### Phase 1: Backend Application Updates (`src/`)
- [ ] Refactor `ErrorGroupRepository.upsertGroupsBatch()` to execute set-based CTE upsert with count aggregation.
- [ ] Remove `ErrorGroupRepository.lockByFingerprint()` and row-level `FOR UPDATE` queries.
- [ ] Refactor `ErrorRepository.insertManyIfNew()` to accept pre-resolved `error_group_id`.
- [ ] Delete `ErrorRepository.attachGroups()` and remove the secondary update call from `ErrorIngestionService`.
- [ ] Update `event-normalizer.ts` to assign time-ordered `uuidv7` identifiers for `id` and `public_id`.
- [ ] Decouple `telemetry_outbox` write from the raw telemetry batch transaction in `TelemetryWriter`.
- [ ] Realign connection pool configuration in `src/config/env.ts` (`INGESTION_WRITE_POOL_SIZE = 24`, permits = 16).

### Phase 2: Database Schema & Migration Updates (`database/logdbv2/`)
- [ ] Author migration `030_logdb_daily_partitioning.sql`: create partition generator function and pre-create rolling 7-day partitions for all 10 `events_*` tables.
- [ ] Author migration `031_evacuate_default_partitions.sql`: move existing default data into date partitions and enforce validation constraints.
- [ ] Author migration `032_prune_span_log_error_indexes.sql`: drop 16 broad GIN indexes and 8 redundant secondary B-Trees across `events_spans`, `events_logs`, and `events_errors`.
- [ ] Author migration `033_partition_drop_retention.sql`: implement `logdb_enforce_retention_partition_drop()` for raw telemetry tables.
- [ ] Author migration `034_streamline_contract_triggers.sql`: optimize `logdb_sync_typed_event_contract()` to bypass sequence and JSON serialization on pre-normalized rows.

---

## 7. Quarterly Pass/Fail Verification Checklist

Re-run this verification suite quarterly against staging and production databases:

```sql
-- 1. Check for Secondary UPDATE regressions on telemetry tables (Must return 0 rows)
SELECT relname, n_tup_ins, n_tup_upd
  FROM pg_stat_user_tables
 WHERE relname LIKE 'events_%' AND n_tup_upd > 0;

-- 2. Verify all active writes land in date-partitioned tables, NOT in _default (Must return 0 bytes)
SELECT c.relname, pg_total_relation_size(c.oid) AS bytes
  FROM pg_class c
 WHERE c.relname LIKE 'events_%_default' AND pg_total_relation_size(c.oid) > 8192;

-- 3. Confirm partition pruning is active on time-range queries (Must scan single child partition)
EXPLAIN (COSTS OFF)
SELECT count(*) FROM events_spans
 WHERE occurred_at >= NOW() - INTERVAL '6 hours';

-- 4. Check for Index Write Bloat (No event table should have > 6 indexes)
SELECT tablename, count(*) AS total_indexes
  FROM pg_indexes
 WHERE schemaname = 'public' AND tablename LIKE 'events_%'
 GROUP BY tablename
HAVING count(*) > 6;

-- 5. Detect Unused Secondary Indexes (Must return 0 rows after 14 days)
SELECT relname, indexrelname, idx_scan
  FROM pg_stat_user_indexes
 WHERE relname LIKE 'events_%' AND idx_scan = 0;
```

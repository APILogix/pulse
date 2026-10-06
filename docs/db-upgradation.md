# Database Upgradation Plan: Telemetry Ingestion & Optimization Treadmill Remediation

> **Note**: The full comprehensive specification is maintained in [`docs/modules/ingestion/db-upgradation.md`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/docs/modules/ingestion/db-upgradation.md).

**Target System**: Pulse Telemetry Ingestion Pipeline (`Fastify` Gateway, `pg-boss` Worker Registry, `EventProcessor`, `TelemetryWriter`, `PostgreSQL 16` Log DB)  
**Methodological Basis**: Tiger Data ("The Optimization Treadmill") & ClickHouse Architectural Principles  
**Document Purpose**: Definitive technical roadmap and engineering specification for upgrading Pulse's PostgreSQL storage engine and backend ingestion workers to resolve production bottlenecks.

---

## 1. Executive Summary & Audit Baseline

Recent profiler logs and forensic audits established that Pulse's telemetry ingestion suffers from severe transaction latency (**3.0s to 15.3s per batch**) and queue delay (**6.1s to 6.6s**), resulting in end-to-end event delays of **10s to 47s**.

The audit identified five structural root causes:
1. **The Pseudo-Partitioning Trap (`events_*_default`)**: Range partitioning is declared on `occurred_at`, but 100% of data routes into a single catch-all `_default` partition. Partition pruning fails, and retention is forced into expensive row-by-row `DELETE`s.
2. **Error Ingestion Mutation & Double-Writing ($3N+6$ Queries)**: Error batches execute an $O(N)$ row-locking loop (`SELECT ... FOR UPDATE` on `error_groups`), followed by an immediate secondary `UPDATE events_errors` via `attachGroups()`, causing 100% dead-tuple ratios and lock timeouts (`55P03`).
3. **Index Write Amplification & Random UUID B-Tree Splitting**: Raw event tables carry up to 26 indexes with random `UUIDv4` primary keys. Inserts scatter across B-Tree leaf blocks, triggering continuous 50/50 page splits, cache eviction, and excessive WAL flush latency (`commitMs` up to 2,027ms).
4. **Outbox CTE & Global Lock Contention**: A 3-part CTE unnesting 9 typed arrays into an unpartitioned global table (`alert_runtime_idempotency_keys`) inside the telemetry transaction causes 1.0s–2.1s stalls on trivial 2-event batches.
5. **Concurrency Misalignment & Pool Starvation**: 80 worker threads compete for 16 write permits and 8–20 pool connections, converting database latency directly into head-of-line queue delay.

---

## 2. Architectural Principles: Tiger Data & ClickHouse Synthesis

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                ARCHITECTURAL EVOLUTION PRINCIPLES                                │
├──────────────────────────────┬──────────────────────────────────┬────────────────────────────────┤
│ Dimension                    │ Relational Anti-Pattern (Current)│ Target Upgradation (Tiger/CH)  │
├──────────────────────────────┼──────────────────────────────────┼────────────────────────────────┤
│ Ingestion Immutability       │ Insert + immediate UPDATE pass   │ Strictly append-only events    │
│ Issue Aggregation            │ Row-level SELECT ... FOR UPDATE  │ Single set-based CTE upsert    │
│ Primary Key Indexing         │ Random UUIDv4 (Random I/O splits)│ Sequential UUIDv7 (Right-edge) │
│ Query Filtering              │ 15–26 secondary B-Tree/GIN index │ Sparse BRIN + Partition Pruning│
│ Partition Lifecycle          │ 1 giant _default partition       │ Pre-created daily partitions   │
│ Retention Enforcement        │ Row-by-row DELETE (Heavy WAL)    │ Zero-cost DROP PARTITION       │
│ Notification Outbox          │ Synchronous CTE in batch tx      │ Async post-commit dispatch     │
│ Batch Sizing & Concurrency   │ 80 connections x small batches   │ Micro-batches x aligned pool   │
└──────────────────────────────┴──────────────────────────────────┴────────────────────────────────┘
```

### Principle A: Strictly Immutable, Append-Only Telemetry
* **Lesson**: Observability engines (ClickHouse, Sentry, Tiger Data) strictly forbid mutating raw telemetry rows after write. 
* **Application**: `events_errors`, `events_spans`, and `events_requests` must never be touched by `UPDATE` queries. State tracking (e.g. `error_groups`) must be decoupled or resolved prior to insertion.

### Principle B: Sparse Indexing & Right-Edge Appends Over B-Tree Overkill
* **Lesson**: Tiger Data highlights secondary B-Trees as an "invisible write tax". ClickHouse relies on sparse primary indexes (`ORDER BY`) rather than secondary B-Trees.
* **Application**: Reduce index counts from 26 to $\le 4$ per table. Replace secondary B-Trees with PostgreSQL **BRIN (Block Range Index)** for time filtering, and migrate primary keys to **UUIDv7** to eliminate 50/50 page splits.

### Principle C: Micro-Batch Coalescence Over Connection Fan-Out
* **Lesson**: ClickHouse’s cardinal rule is: *"Insert in large batches (500–5,000 rows), never high-concurrency tiny writes."*
* **Application**: Rather than 80 workers firing tiny 10-row transactions at an 8-connection pool, workers coalesce jobs into larger batches processed through strictly sized database connection permits.

### Principle D: Partition-Drop Lifecycle Management
* **Lesson**: Data retention in time-series systems must be a metadata-only operation (`ALTER TABLE DROP PARTITION`). Row-level `DELETE` is an operational dead-end.
* **Application**: Pre-create rolling daily partitions and drop aged partitions via zero-cost DDL.

---

## 3. Backend Upgradation Specification (`src/`)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   BACKEND UPGRADATION FLOW                                       │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
   Gateway HTTP Ingestion
             │
             ▼
   [event-normalizer.ts] ──────► Pre-generate sequential UUIDv7 IDs & timestamps in Node.js
             │
             ▼
   [error-ingestion.service.ts]► Group unique (project_id, fingerprint) in memory with summed counts
             │
             ├─────────────────► Step 1: Set-based CTE upsert on error_groups (1 query)
             │                   RETURNING id, fingerprint
             │
             ├─────────────────► Step 2: Map pre-resolved error_group_id to error rows in memory
             │
             ├─────────────────► Step 3: Single-pass bulk INSERT into events_errors (1 query)
             │                   (Zero secondary UPDATE attachGroups, Zero dead tuples)
             │
             └─────────────────► Step 4: COMMIT transaction
                                       │
                                       ▼
             [telemetry-writer.ts] ──► Async Post-Commit Outbox & Event Dispatch
```

### 3.1 Error Ingestion Pipeline Refactoring
**Files**:
* [`src/modules/errors/repositories/error-group.repository.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/errors/repositories/error-group.repository.ts)
* [`src/modules/errors/repositories/error.repository.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/errors/repositories/error.repository.ts)
* [`src/modules/errors/services/error-ingestion.service.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/errors/services/error-ingestion.service.ts)

**Key Actions**:
1. Remove `SELECT ... FOR UPDATE` row locks in `error-group.repo.ts`.
2. Implement single set-based CTE upsert `ErrorGroupRepository.upsertGroupsSetBased()`.
3. Pre-resolve `error_group_id` before insert in `ErrorRepository.insertManyIfNew()`.
4. Delete `ErrorRepository.attachGroups()` to eliminate the secondary update and dead-tuple generation.

---

### 3.2 Time-Ordered ID Generation at Gateway Boundary
**File**: [`src/modules/ingestion/pipeline/event-normalizer.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/ingestion/pipeline/event-normalizer.ts)

**Key Actions**:
1. Assign sequential `uuidv7` for `id` and `public_id` in Node.js.
2. Supply `public_id`, `created_at`, `ingested_at`, and `payload` explicitly to bypass database sequence locks (`nextval`) and trigger fallbacks.

---

### 3.3 Outbox & Idempotency Decoupling
**File**: [`src/modules/ingestion/pipeline/telemetry-writer.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/ingestion/pipeline/telemetry-writer.ts)

**Key Actions**:
1. Decouple `appendTelemetryOutbox()` from the synchronous telemetry transaction.
2. Dispatch alert outbox jobs post-commit via async event emitter or Redis queue.
3. Migrate `alert_runtime_idempotency_keys` reservation to Redis (`SET NX EX 86400`).

---

### 3.4 Worker Concurrency & Sizing Alignment
**Files**: 
* [`src/config/env.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/config/env.ts)
* [`src/modules/ingestion/workers/worker-registry.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/ingestion/workers/worker-registry.ts)

**Key Actions**:
1. Set `INGESTION_WRITE_POOL_SIZE = 24` with `INGESTION_WRITE_CONCURRENCY = 16` permits.
2. Increase chunk size (`INGESTION_JOB_CHUNK_SIZE`) to **500 events**.
3. Align worker polling so queue workers do not stall in Node.js semaphore queues.

---

## 4. Database Upgradation Specification (`database/logdbv2/`)

### 4.1 Migration Phase 1: Rolling Daily Range Partitioning
**Target Migration**: `database/logdbv2/migrations/000030_daily_range_partitioning.up.sql`
* Deploy `logdb_ensure_daily_partitions(p_table_name, p_days_ahead)` function.
* Pre-create 14 rolling daily partitions for `events_requests`, `events_errors`, `events_spans`, `events_traces`, `events_logs`, and `events_metrics`.

### 4.2 Migration Phase 2: Default Partition Evacuation & Detach
**Target Migration**: `database/logdbv2/migrations/000031_evacuate_default_partitions.up.sql`
* Evacuate existing rows from `events_*_default` into daily partitions.
* Detach and drop `events_*_default` to re-enable native partition pruning.

### 4.3 Migration Phase 3: Index Pruning on Hot-Path Tables
**Target Migration**: `database/logdbv2/migrations/000032_prune_telemetry_indexes.up.sql`
* Drop broad JSONB GIN indexes across `events_spans`, `events_logs`, and `events_errors`.
* Drop zero-scan secondary B-Trees (`idx_events_spans_slow_db`, `idx_events_logs_host_time`, etc.).
* Cap indexes at $\le 4$ per table, backed by BRIN on `occurred_at`.

### 4.4 Migration Phase 4: Zero-Cost Partition-Drop Retention
**Target Migration**: `database/logdbv2/migrations/000033_partition_drop_retention.up.sql`
* Deploy `logdb_enforce_retention_partition_drop(p_table_name, p_retention_days)`.
* Automatically detach and drop partitions older than the retention threshold with zero WAL overhead.

---

## 5. Performance Verification & Acceptance Criteria

```sql
-- 1. Check for Secondary Updates (MUST BE 0)
SELECT relname, n_tup_ins, n_tup_upd
  FROM pg_stat_user_tables
 WHERE relname LIKE 'events_%' AND n_tup_upd > 0;

-- 2. Check for Default Partition Writes (MUST BE 0)
SELECT c.relname, pg_total_relation_size(c.oid) AS bytes
  FROM pg_class c
 WHERE c.relname LIKE 'events_%_default' AND pg_total_relation_size(c.oid) > 8192;

-- 3. Confirm Partition Pruning in EXPLAIN
EXPLAIN (COSTS OFF)
SELECT count(*) FROM events_spans
 WHERE occurred_at >= NOW() - INTERVAL '12 hours';

-- 4. Check Total Index Count per Table (MUST BE <= 5)
SELECT tablename, count(*) AS total_indexes
  FROM pg_indexes
 WHERE schemaname = 'public' AND tablename LIKE 'events_%'
 GROUP BY tablename
HAVING count(*) > 5;
```

---

## 6. Implementation Rollout Plan

| Step | Scope | Action | Risk / Downtime |
| :---: | :---: | :--- | :---: |
| **1** | Database | Run Migration `000030`: Pre-create rolling daily partitions. | Zero downtime |
| **2** | Backend | Deploy UUIDv7 sequential ID generator and supply explicit `public_id`. | Zero downtime |
| **3** | Backend | Deploy set-based CTE upsert for `error_groups` and remove `attachGroups()`. | Zero downtime |
| **4** | Database | Run Migration `000032`: Drop broad GIN and unused secondary B-Tree indexes. | Zero downtime (`CONCURRENTLY`) |
| **5** | Database | Run Migration `000031`: Evacuate and detach `_default` partition. | Brief table lock |
| **6** | Database | Run Migration `000033`: Activate automated partition-drop retention cron. | Zero downtime |
| **7** | Backend | Adjust `env.ts` worker concurrency and connection pool sizing. | Worker restart |

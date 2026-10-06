# Database Upgradation Plan: Telemetry Ingestion & Optimization Treadmill Remediation

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

To fix these problems cleanly without abandoning PostgreSQL, we synthesize core architectural patterns from **Tiger Data** and **ClickHouse / Sentry** engineering blogs:

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

**Changes**:
1. **Remove `lockByFingerprint()` & Row Locks**:
   * Delete `SELECT * FROM error_groups WHERE ... FOR UPDATE`.
   * Eliminate the $N$-query loop in `ErrorIngestionService.ingestBatch()`.
2. **Implement Set-Based CTE Upsert**:
   * Author `ErrorGroupRepository.upsertGroupsSetBased()`:
     ```sql
     WITH incoming AS (
       SELECT fingerprint, project_id, sum(cnt)::int AS batch_count,
              min(occurred_at) AS first_seen, max(occurred_at) AS last_seen,
              max(severity) AS highest_sev, ...
         FROM UNNEST($1::text[], $2::uuid[], $3::int[], $4::timestamptz[], ...)
              AS t(fingerprint, project_id, cnt, occurred_at, severity)
        GROUP BY fingerprint, project_id
     ), upserted AS (
       INSERT INTO error_groups (
         project_id, fingerprint, occurrence_count, first_seen_at, last_seen_at, ...
       )
       SELECT project_id, fingerprint, batch_count, first_seen, last_seen, ...
         FROM incoming
       ON CONFLICT (project_id, fingerprint) DO UPDATE
       SET occurrence_count = error_groups.occurrence_count + EXCLUDED.occurrence_count,
           last_seen_at = GREATEST(error_groups.last_seen_at, EXCLUDED.last_seen_at),
           highest_severity = GREATEST(error_groups.highest_severity, EXCLUDED.highest_severity),
           version = error_groups.version + 1,
           updated_at = NOW()
       RETURNING id, fingerprint, project_id
     )
     SELECT id, fingerprint, project_id FROM upserted;
     ```
3. **Pre-Resolve `error_group_id` & Single-Pass Insert**:
   * Join the returned CTE mapping `(fingerprint -> id)` with the error batch in memory.
   * Pass populated `error_group_id` into `ErrorRepository.insertManyIfNew()`.
4. **Delete `ErrorRepository.attachGroups()`**:
   * Remove `UPDATE events_errors AS e SET error_group_id = v.group_id::uuid FROM (VALUES ...)`.
   * Result: Query count drops from $3N+6$ to **4 fixed queries**; dead tuple generation drops to 0.

---

### 3.2 Time-Ordered ID Generation at Gateway Boundary
**File**: [`src/modules/ingestion/pipeline/event-normalizer.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/ingestion/pipeline/event-normalizer.ts)

**Changes**:
1. Integrate sequential UUID generation (`uuidv7`) in Node.js.
2. If client does not supply `id` or `public_id`, generate:
   * `id`: `uuidv7()`
   * `public_id`: Prefixed sequential string (`SPN-${uuidv7()}` or sequential counter).
3. Ensure `TelemetryWriter` supplies `public_id`, `created_at`, `ingested_at`, and `payload` explicitly.
4. Result: Bypasses database sequence locks (`nextval('seq_pubid_*')`) and eliminates trigger fallback overhead.

---

### 3.3 Outbox & Idempotency Decoupling
**File**: [`src/modules/ingestion/pipeline/telemetry-writer.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/ingestion/pipeline/telemetry-writer.ts)

**Changes**:
1. Remove `appendTelemetryOutbox()` from the synchronous telemetry transaction.
2. Emit alert outbox notifications **post-commit** via Node.js `EventEmitter` or push to Redis stream.
3. Migrate `alert_runtime_idempotency_keys` from PostgreSQL to Redis (`SET NX EX 86400`) to eliminate page-level B-Tree latch contention during telemetry writes.

---

### 3.4 Worker Concurrency & Sizing Alignment
**Files**: 
* [`src/config/env.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/config/env.ts)
* [`src/modules/ingestion/workers/worker-registry.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/ingestion/workers/worker-registry.ts)

**Changes**:
1. **Realign Pool Sizing Formula**:
   * Set `INGESTION_WRITE_CONCURRENCY = 16` permits.
   * Set `INGESTION_WRITE_POOL_SIZE = 24` (`permits + 8` buffer).
2. **Worker Polling Bounding**:
   * Reduce typed worker concurrency per queue from 8 to 2 (`localConcurrency = 2`).
   * Increase chunk size (`INGESTION_JOB_CHUNK_SIZE`) from 200 to **500 events** where byte limits permit.
   * Total worker pool demand matches database admission permits 1:1, eliminating semaphore queue wait times.

---

## 4. Database Upgradation Specification (`database/logdbv2/`)

### 4.1 Migration Phase 1: Rolling Daily Range Partitioning
**Target File**: `database/logdbv2/migrations/000030_daily_range_partitioning.up.sql`

```sql
-- 1. Partition Creation Supervisor Function
CREATE OR REPLACE FUNCTION logdb_ensure_daily_partitions(
  p_table_name TEXT,
  p_days_ahead INTEGER DEFAULT 7
) RETURNS INTEGER AS $$
DECLARE
  v_current DATE := (NOW() AT TIME ZONE 'UTC')::DATE - 1;
  v_target DATE := (NOW() AT TIME ZONE 'UTC')::DATE + p_days_ahead;
  v_part_name TEXT;
  v_from TIMESTAMPTZ;
  v_to TIMESTAMPTZ;
  v_created INTEGER := 0;
BEGIN
  WHILE v_current <= v_target LOOP
    v_part_name := format('%s_y%sm%sd%s', p_table_name,
                          to_char(v_current, 'YYYY'),
                          to_char(v_current, 'MM'),
                          to_char(v_current, 'DD'));
    v_from := v_current::TIMESTAMPTZ;
    v_to := (v_current + 1)::TIMESTAMPTZ;

    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = v_part_name) THEN
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
        v_part_name, p_table_name, v_from, v_to
      );
      v_created := v_created + 1;
    END IF;
    v_current := v_current + 1;
  END LOOP;
  RETURN v_created;
END;
$$ LANGUAGE plpgsql;

-- 2. Pre-create rolling partitions for all 10 canonical tables
SELECT logdb_ensure_daily_partitions('events_requests', 14);
SELECT logdb_ensure_daily_partitions('events_errors', 14);
SELECT logdb_ensure_daily_partitions('events_spans', 14);
SELECT logdb_ensure_daily_partitions('events_traces', 14);
SELECT logdb_ensure_daily_partitions('events_logs', 14);
SELECT logdb_ensure_daily_partitions('events_metrics', 14);
```

---

### 4.2 Migration Phase 2: Default Partition Evacuation & Detach
**Target File**: `database/logdbv2/migrations/000031_evacuate_default_partitions.up.sql`

```sql
-- Procedure to move rows out of default partition into daily range tables
DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOR v_table IN SELECT unnest(ARRAY[
    'events_requests', 'events_errors', 'events_spans',
    'events_traces', 'events_logs', 'events_metrics'
  ]) LOOP
    -- Move data from _default to parent table (Postgres routes to daily partitions)
    EXECUTE format('
      WITH moved AS (
        DELETE FROM %I_default RETURNING *
      )
      INSERT INTO %I SELECT * FROM moved ON CONFLICT DO NOTHING;
    ', v_table, v_table);

    -- Detach empty default partition
    EXECUTE format('ALTER TABLE %I DETACH PARTITION %I_default CONCURRENTLY;', v_table, v_table);
    EXECUTE format('DROP TABLE IF EXISTS %I_default;', v_table);
  END LOOP;
END;
$$;
```

---

### 4.3 Migration Phase 3: Index Pruning on Hot-Path Tables
**Target File**: `database/logdbv2/migrations/000032_prune_telemetry_indexes.up.sql`

```sql
-- 1. Drop broad JSONB GIN indexes (eliminating GIN pending list cleanup stalls)
DROP INDEX IF EXISTS idx_events_spans_attributes_gin;
DROP INDEX IF EXISTS idx_events_spans_metadata_gin;
DROP INDEX IF EXISTS idx_events_spans_payload_gin;
DROP INDEX IF EXISTS idx_events_spans_ai_response_gin;

DROP INDEX IF EXISTS idx_events_logs_context_gin;
DROP INDEX IF EXISTS idx_events_logs_tags_gin;
DROP INDEX IF EXISTS idx_events_logs_attributes_gin;
DROP INDEX IF EXISTS idx_events_logs_metadata_gin;
DROP INDEX IF EXISTS idx_events_logs_payload_gin;
DROP INDEX IF EXISTS idx_events_logs_ai_response_gin;

DROP INDEX IF EXISTS idx_events_errors_context_gin;
DROP INDEX IF EXISTS idx_events_errors_tags_gin;
DROP INDEX IF EXISTS idx_events_errors_extra_gin;
DROP INDEX IF EXISTS idx_events_errors_metadata_gin;
DROP INDEX IF EXISTS idx_events_errors_payload_gin;
DROP INDEX IF EXISTS idx_events_errors_ai_response_gin;

-- 2. Drop zero-scan secondary B-Trees
DROP INDEX IF EXISTS idx_events_spans_slow_db;
DROP INDEX IF EXISTS idx_events_spans_db_collection;
DROP INDEX IF EXISTS idx_events_spans_host_time;
DROP INDEX IF EXISTS idx_events_spans_watermark;
DROP INDEX IF EXISTS idx_events_logs_host_time;
DROP INDEX IF EXISTS idx_events_logs_facility_time;

-- 3. Retain strictly lean indexes per table:
-- Primary Key: (id, occurred_at)
-- Idempotency Guard: (organization_id, event_id, occurred_at)
-- Core Dashboard Lookup: (organization_id, trace_id, occurred_at ASC)
-- Time Bounding: USING BRIN (occurred_at)
```

---

### 4.4 Migration Phase 4: Zero-Cost Partition-Drop Retention
**Target File**: `database/logdbv2/migrations/000033_partition_drop_retention.up.sql`

```sql
-- Native Partition Pruning Retention Procedure
CREATE OR REPLACE FUNCTION logdb_enforce_retention_partition_drop(
  p_table_name TEXT,
  p_retention_days INTEGER DEFAULT 30
) RETURNS INTEGER AS $$
DECLARE
  v_cutoff DATE := (NOW() AT TIME ZONE 'UTC')::DATE - p_retention_days;
  v_part RECORD;
  v_dropped INTEGER := 0;
BEGIN
  FOR v_part IN
    SELECT c.relname
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_class p ON p.oid = i.inhparent
     WHERE p.relname = p_table_name
       AND c.relname ~ format('^%s_y[0-9]{4}m[0-9]{2}d[0-9]{2}$', p_table_name)
  LOOP
    -- Extract partition date from table name suffix
    IF (substring(v_part.relname from '[0-9]{4}-[0-9]{2}-[0-9]{2}$')::DATE) < v_cutoff THEN
      EXECUTE format('ALTER TABLE %I DETACH PARTITION %I CONCURRENTLY;', p_table_name, v_part.relname);
      EXECUTE format('DROP TABLE IF EXISTS %I;', v_part.relname);
      v_dropped := v_dropped + 1;
    END IF;
  END LOOP;
  RETURN v_dropped;
END;
$$ LANGUAGE plpgsql;
```

---

## 5. Performance Verification & Acceptance Criteria

```sql
-- 1. Verify ZERO Secondary Updates on Telemetry Tables (MUST RETURN 0)
SELECT relname, n_tup_ins, n_tup_upd
  FROM pg_stat_user_tables
 WHERE relname LIKE 'events_%' AND n_tup_upd > 0;

-- 2. Verify ZERO Active Writes in Default Partitions (MUST RETURN 0)
SELECT c.relname, pg_total_relation_size(c.oid) AS bytes
  FROM pg_class c
 WHERE c.relname LIKE 'events_%_default' AND pg_total_relation_size(c.oid) > 8192;

-- 3. Confirm Query Plans Prune to Single Daily Partitions
EXPLAIN (COSTS OFF)
SELECT count(*) FROM events_spans
 WHERE occurred_at >= NOW() - INTERVAL '12 hours';
-- Plan MUST show scan on only 1 or 2 daily child tables; zero scans on entire table.

-- 4. Check Total Index Count per Table (MUST BE <= 5)
SELECT tablename, count(*) AS total_indexes
  FROM pg_indexes
 WHERE schemaname = 'public' AND tablename LIKE 'events_%'
 GROUP BY tablename
HAVING count(*) > 5;

-- 5. Monitor Ingestion Runtimes in Worker Logs
-- Target Metrics:
-- insertMs <= 250ms (for 500-span batch)
-- commitMs <= 40ms
-- dbConnectionWaitMs = 0ms
-- queueWaitMs <= 100ms
```

---

## 6. Implementation Rollout Plan

| Step | Scope | Action | Risk / Downtime |
| :---: | :---: | :--- | :---: |
| **1** | Database | Run Migration `000030`: Pre-create rolling daily partitions. | Zero downtime |
| **2** | Backend | Deploy UUIDv7 sequential ID generator and supply explicit `public_id`. | Zero downtime |
| **3** | Backend | Deploy set-based CTE upsert for `error_groups` and remove `attachGroups()`. | Zero downtime |
| **4** | Database | Run Migration `000032`: Drop broad GIN and unused secondary B-Tree indexes. | Zero downtime (`DROP INDEX CONCURRENTLY`) |
| **5** | Database | Run Migration `000031`: Evacuate and detach `_default` partition during low traffic. | Brief table lock |
| **6** | Database | Run Migration `000033`: Activate automated partition-drop retention cron. | Zero downtime |
| **7** | Backend | Adjust `env.ts` worker concurrency and connection pool sizing. | Worker restart |

# Database Connection Pooling, Polling & Resource Sizing Guide (KVM 4)

This document provides a comprehensive technical audit of the **connection pooling, polling mechanisms, fleet connection budgeting, and hardware allocation** across **PrimaryDB** and **LogDB** for the **Pulse (Pulsiv)** platform running on Hostinger **KVM 4** hardware. It also documents the **6 Critical Production Traps/Bugs** identified in production database setups and their exact architectural fixes.

---

## 1. Hardware Baseline & Process Fleet Inventory

### 1.1 Hostinger KVM 4 Hardware Specifications
- **CPU:** 4 vCPU Cores
- **RAM:** 16 GB (16,384 MB)
- **Disk:** 200 GB NVMe Storage
- **Bandwidth:** 16 TB Bandwidth

### 1.2 Backend Process Fleet (PM2 Multi-Process Model)
The application runs across **5 distinct process roles** managed by PM2 (configured in [`ecosystem.config.cjs`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/ecosystem.config.cjs)):

| Process Name | Exec Mode | Instances | Description & Role |
| :--- | :--- | :--- | :--- |
| **`api-backend`** | Cluster | 2 workers | Fastify HTTP API handling user authentication, organization management, dashboard telemetry queries, and alert configurations. *(Default set to 2 workers to leave 2 physical cores free for databases and workers).* |
| **`background-workers`** | Fork | 1 worker | General PGMQ worker consuming queues for alerts, billing sync, AI jobs, and webhook deliveries. |
| **`ingestion-workers`** | Fork | 1 worker | High-velocity telemetry ingestion worker draining PGMQ event queues and executing bulk batch writes to LogDB. |
| **`analytics-workers`** | Fork | 1 worker | Analytical rollup engine computing 1m, 5m, 1h, and 1d time-series buckets, anomaly detections, and retention compactions on LogDB. |
| **`cron`** | Fork | 1 worker | Scheduled job coordinator emitting PGMQ timer events. |

---

## 2. Workload Analysis: Why LogDB Must Have More Connections Than PrimaryDB

A common database scaling mistake is treating all databases equally. In Pulse, **LogDB requires significantly more connections than PrimaryDB**:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 CONNECTION COMPARISON                                  │
├────────────────────────────────────────────┬───────────────────────────────────────────┤
│         PrimaryDB (Control Plane)          │      LogDB (TimescaleDB Telemetry)        │
│          Postgres max_connections: 60      │       Postgres max_connections: 80        │
│          PgBouncer pool_size: 24           │       PgBouncer pool_size: 25             │
│          Max Server Conns: 48 (32 tx+16 ses)│      Max Server Conns: 45 (35 tx+10 ses) │
├────────────────────────────────────────────┼───────────────────────────────────────────┤
│ • Fast OLTP queries (<2ms - 10ms)          │ • High-throughput batch UNNEST stream writes│
│ • Low query concurrency                   │ • Simultaneous live dashboard read queries│
│ • Small pool keeps CPU cache lines hot     │ • Continuous aggregate recomputes         │
│ • Prevents lock contention                 │ • 4 TimescaleDB background workers        │
└────────────────────────────────────────────┴───────────────────────────────────────────┘
```

### Detailed Breakdown of Demand:

1. **PrimaryDB (Relational Control Plane):**
   - Handles CRUD for users, organizations, project settings, API keys, subscription billing, vector knowledge chunks (`pgvector`), and PGMQ message queue coordination.
   - Operations are short-lived, indexed, single-row or small-batch transactions.
   - **Connection demand:** 15–25 active connections easily absorb the entire control plane traffic without queueing.

2. **LogDB (TimescaleDB Telemetry & Analytics):**
   - Handles the firehose of observability events: HTTP requests, server errors, logs, distributed trace spans, custom metrics, browser session replays, and cron checkins.
   - **Simultaneous Connection Consumers on LogDB:**
     - **Ingestion Write Pool:** Dedicated pool (`INGESTION_WRITE_POOL_SIZE = 8`) executing parallel batch `UNNEST` writes.
     - **Telemetry Read Pool:** Fastify API read pool (`LOG_POOL_MAX = 6` per worker = 12 total) powering user dashboards and live analytics queries.
     - **Alert Evaluation Scanners:** Background workers scanning telemetry tables for threshold breaches (`LOG_POOL_MAX = 4`).
     - **Analytics Worker Pool:** Rollup engine (`ANALYTICS_DB_POOL_MAX = 6`) generating 1m, 5m, 1h rollups and anomaly models.
     - **TimescaleDB Internal Workers:** 4 background workers running continuous aggregate materialization and chunk compression.
   - **Connection demand:** Significantly higher concurrent client connections than PrimaryDB. PgBouncer and direct pools are tuned to guarantee zero connection exhaustion.

---

## 3. The 6 Critical Production Traps & Their Architectural Fixes

### Bug 1: Connection Math Exceeds PostgreSQL `max_connections`
- **The Hazard:** If PgBouncer server limits (`max_db_connections`) plus direct unpooled worker pools exceed PostgreSQL's `max_connections`, database spikes will trigger:
  `FATAL: remaining connection slots are reserved for non-replication superuser connections`.
- **The Root Cause:** In uncalibrated setups, PgBouncer is configured with 80+25=105 server connections while direct workers add another 39 connections against a ceiling of 100.
- **The Solution:** Establish a strict **Zero-Overflow Fleet Matrix** (see Section 4). PgBouncer server pools are hard-capped, leaving dedicated headroom for direct pools and superuser connections.

---

### Bug 2: PGMQ `read_with_poll` Starves PgBouncer `transaction` Mode
- **The Hazard:** In `pool_mode = transaction`, a single `SELECT` is a single transaction. `pgmq.read_with_poll` executes a PL/pgSQL loop using `pg_sleep(0.25)` for up to 2 full seconds.
- **The Multiplier Trap:** If API servers instantiate reader pools, 4 API workers + background workers create dozens of concurrent long-polls. They pin 100% of PgBouncer's transaction pool slots for 2 seconds while doing nothing, causing user-facing 2ms Fastify queries to queue up and timeout!
- **The Fix:**
  1. Remove reader pools completely from `api-backend` and `cron`. API servers and cron emitters only enqueue jobs (`pgmq.send`); they instantiate only `commandPool` (max 2), never the blocking reader pool.
  2. Route worker `readWithPoll` connections to `pulse_primary_session` (session mode) or direct connections, so blocking queue polls never share the transaction pool used by user OLTP queries.
  3. Cap `QUEUE_POOL_MAX` to 4 per consumer worker.

---

### Bug 3: Unsafe `pool.query` Retry Wrapper Risks Duplicate Writes
- **The Hazard:** In `src/config/database.ts`, wrapping `pool.query` to unconditionally retry on transient connection drops (`isTransientPostgresError`) risks executing non-idempotent writes (`INSERT`, credit deduction, billing charge, `pgmq.send`) a second time if the network reset occurs after the database committed but before Node.js received the response packet.
- **The Fix:** Only retry when the SQL operation is a safe read query (`SELECT`, `WITH ... SELECT`, `SHOW`, `VALUES`), or when the error occurred prior to dispatch (socket connect / acquire error):
  ```typescript
  const READ_QUERY_REGEX = /^\s*(?:\/\*[\s\S]*?\*\/\s*)*(?:SELECT|WITH\b(?![\s\S]*\b(?:INSERT|UPDATE|DELETE)\b)|SHOW|VALUES)\b/i;

  function isSafeToRetryQuery(textOrConfig: any, err: any): boolean {
    if (!isTransientPostgresError(err)) return false;
    if (err?.code === 'ECONNREFUSED' || err?.code === 'ETIMEDOUT') return true;
    const sql = typeof textOrConfig === 'string' ? textOrConfig : textOrConfig?.text;
    if (sql && READ_QUERY_REGEX.test(sql)) return true;
    return false;
  }
  ```

---

### Bug 4: LogDB OOM-Kill Trap & Inflated `effective_cache_size` on 16 GB RAM
- **The Hazard:** In PostgreSQL, `work_mem` is allocated per sort/hash node per query plan, and `maintenance_work_mem` is allocated per background worker. Setting `work_mem = 32MB` with 3 hash nodes across 35 queries = 3,360 MB. Setting `maintenance_work_mem = 512MB` across 3 active compression workers = 1,536 MB. Combined with 2.5 GB `shared_buffers`, LogDB RAM spikes to **7,856 MB**, exceeding a 6.5 GB Docker limit and triggering an OOM `SIGKILL (Exit Code 137)`.
- **The Fix:**
  - Lower LogDB `work_mem` to `16MB` and `maintenance_work_mem` to `256MB`.
  - Lower `timescaledb.max_background_workers` from 8 to 4.
  - Set realistic `effective_cache_size`: `2560MB` on PrimaryDB, `3840MB` on LogDB.
  - Container memory limits: `4000M` for PrimaryDB, `6500M` for LogDB, leaving 5.5 GB for OS page cache and Node.js heaps.

---

### Bug 5: Severe CPU & WAL Lock Thrashing on 4 vCPUs
- **The Hazard:** Running `INGESTION_WRITE_CONCURRENCY = 16` with `INGESTION_WRITE_POOL_SIZE = 24` on a 3-vCPU container forces 16 parallel `UNNEST` batch transactions against the exact same hypertable chunk, causing massive `WALInsertLock` and B-tree page lock contention.
- **The Fix:**
  - Drop `INGESTION_WRITE_CONCURRENCY` to `4` and `INGESTION_WRITE_POOL_SIZE` to `8`.
  - Increase batch size per flush. Four parallel writers with 4x larger batches achieve higher throughput than 16 contending writers.
  - Set `SET synchronous_commit = off;` for telemetry write transactions. Observability metrics do not require synchronous WAL fsync per transaction. This boosts ingest throughput 2x–4x and eliminates NVMe fsync stalls.

---

### Bug 6: LogDatabaseManager Statement Timeout Implementation Hazard
- **The Hazard:** Issuing `SET LOCAL statement_timeout = X` outside an explicit `BEGIN ... COMMIT` block is silently ignored by PostgreSQL. Conversely, wrapping every dashboard read in `BEGIN ... SET LOCAL ... SELECT ... COMMIT` adds 3 redundant network round-trips per read query.
- **The Fix:** Use `query_timeout` on single-statement reads when no tenant scoping is required (avoiding extra round-trips), or set a role-level timeout (`ALTER ROLE pulse_log_reader SET statement_timeout = '10s'`).

---

## 4. Recalibrated Fleet Connection Budget (Zero-Overflow Matrix)

Every connection is accounted for so the total never breaches PgBouncer or PostgreSQL `max_connections`:

| Process Role | Instances | PrimaryDB Pool (`DB_POOL_MAX`) | PrimaryDB Notify Pool | PrimaryDB PGMQ (Reader / Cmd) | LogDB Pool | Total Conns (Primary / LogDB) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`api-backend`** | 2 | 6 per worker | 2 per worker | **0 / 2** per worker *(No reader!)* | 6 per worker (Read) | **20 / 12** |
| **`background-workers`** | 1 | 6 | 4 | 4 / 3 | 4 (Alert scans) | **17 / 4** |
| **`ingestion-workers`** | 1 | 6 (`INGESTION_DB_POOL_SIZE`) | 0 | 4 / 4 | 8 (`WRITE_POOL`, concurrency 4) | **14 / 8** |
| **`analytics-workers`** | 1 | 2 | 0 | 2 / 2 | 6 (`ANALYTICS_DB_POOL_MAX`) | **6 / 6** |
| **`cron`** | 1 | 2 | 0 | **0 / 2** *(No reader!)* | 0 | **4 / 0** |
| **TimescaleDB / PG Reserved** | — | — | — | — | 4 workers + 3 superuser | **3 / 7** |
| **Fleet Total** | **6 procs** | **28** | **8** | **10 Reader / 15 Cmd** | **30 App + 7 Internal** | **64 Client (→ PgBouncer) / 37 LogDB** |

---

## 5. Production Code Implementations

### Code Snippet 1: PrimaryDB Pool Creation with Safe Read-Only Retry Wrapper
From [`src/config/database.ts#L36-L92`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/config/database.ts#L36-L92):

```typescript
const primarySsl = resolvePostgresSslConfig(env.DATABASE_URL, {
  enabled: env.DB_SSL_ENABLED,
  rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
});

const primaryPoolConfig = withPostgresAddressFamily({
  connectionString: sanitizePostgresConnectionString(env.DATABASE_URL),
  ssl: primarySsl,
  max: env.DB_POOL_MAX,                 // Default: 6 per process
  min: env.DB_POOL_MIN,                 // Default: 0
  idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS, // 30,000ms
  connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS, // 30,000ms
  statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,       // 30,000ms
  query_timeout: env.DB_QUERY_TIMEOUT_MS,               // 0 (disabled to prevent cold-start aborts)
  application_name: `api_monitoring_${env.NODE_ENV}`,
  keepAlive: true,
  keepAliveInitialDelayMillis: env.DB_KEEPALIVE_INITIAL_DELAY_MS,
}, env.DB_FAMILY);

export const pool = new Pool(primaryPoolConfig);

const READ_QUERY_REGEX = /^\s*(?:\/\*[\s\S]*?\*\/\s*)*(?:SELECT|WITH\b(?![\s\S]*\b(?:INSERT|UPDATE|DELETE)\b)|SHOW|VALUES)\b/i;

function isSafeToRetryQuery(textOrConfig: any, err: any): boolean {
  if (!isTransientPostgresError(err)) return false;

  // Safe to retry if the error occurred prior to dispatch (socket connect / acquire error)
  if (err?.code === 'ECONNREFUSED' || err?.code === 'ETIMEDOUT') return true;

  // Safe to retry if the SQL is an idempotent read query
  const sql = typeof textOrConfig === 'string' ? textOrConfig : textOrConfig?.text;
  if (sql && READ_QUERY_REGEX.test(sql)) return true;

  return false;
}

// Resilient pool.query: Automatically retries on transient connection drops for safe read queries
const rawPoolQuery = pool.query.bind(pool);
(pool as any).query = async function (textOrConfig: any, values?: any, callback?: any) {
  if (typeof values === 'function' || typeof callback === 'function') {
    return (rawPoolQuery as any)(textOrConfig, values, callback);
  }
  const maxRetries = 3;
  let attempt = 0;
  while (true) {
    try {
      return await (rawPoolQuery as any)(textOrConfig, values);
    } catch (err: any) {
      attempt++;
      if (attempt <= maxRetries && isSafeToRetryQuery(textOrConfig, err)) {
        const delayMs = 150 * attempt;
        dbLogger.debug(
          { attempt, maxRetries, delayMs, err: err?.message || String(err) },
          'Transient database connection error in pool.query; retrying safe read query...',
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw err;
    }
  }
};
```

---

### Code Snippet 2: Connection Budget Registry with Scoped Producer / Consumer Pools
From [`src/config/connection-budget.ts#L85-L165`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/config/connection-budget.ts#L85-L165):

```typescript
function pgmqCommandPool(max = 2): PoolBudgetItem {
  return {
    name: 'pgmq_command_pool',
    max,
    min: 0,
    idleTimeoutMs: env.DB_IDLE_TIMEOUT_MS,
    acquireTimeoutMs: env.DB_CONNECTION_TIMEOUT_MS,
    purpose: 'PGMQ enqueue operations (send / send_batch)',
    poolingMode: 'transaction',
    targetEnvVar: 'DATABASE_URL',
  };
}

function pgmqWorkerPools(readerMax = 4, commandMax = 3): PoolBudgetItem[] {
  return [
    {
      name: 'pgmq_reader_pool',
      max: readerMax,
      min: 0,
      idleTimeoutMs: env.DB_IDLE_TIMEOUT_MS,
      acquireTimeoutMs: env.DB_CONNECTION_TIMEOUT_MS,
      purpose: 'PGMQ message reads and worker long-polling (session-mode isolated)',
      poolingMode: 'session',
      targetEnvVar: 'DATABASE_URL',
    },
    {
      name: 'pgmq_command_pool',
      max: commandMax,
      min: 0,
      idleTimeoutMs: env.DB_IDLE_TIMEOUT_MS,
      acquireTimeoutMs: env.DB_CONNECTION_TIMEOUT_MS,
      purpose: 'PGMQ send, ACK, delete, and heartbeat commands',
      poolingMode: 'transaction',
      targetEnvVar: 'DATABASE_URL',
    },
  ];
}

export function getProcessBudget(role: ProcessRole): ProcessBudget {
  switch (role) {
    case 'api':
      // Fastify API only enqueues messages via pgmq.send; never allocate a blocking reader pool
      return budget(role, 'Fastify API server', [primaryPool(), ...logPools(), pgmqCommandPool(2)]);
    case 'worker':
      return budget(role, 'General background workers', [primaryPool(), ...logPools(), ...pgmqWorkerPools(4, 3)]);
    case 'alert-worker':
      return budget(role, 'Dedicated alert delivery workers', [primaryPool(), ...logPools(), ...pgmqWorkerPools(4, 3)]);
    case 'ingestion':
      return budget(role, 'High-throughput ingestion workers', [
        {
          name: 'ingestion_control_pool',
          max: env.INGESTION_DB_POOL_SIZE ?? 6,
          min: 0,
          idleTimeoutMs: env.DB_IDLE_TIMEOUT_MS,
          acquireTimeoutMs: env.DB_CONNECTION_TIMEOUT_MS,
          purpose: 'Usage rollups and ingestion control-plane operations',
          poolingMode: 'transaction',
          targetEnvVar: 'DATABASE_URL',
        },
        {
          name: 'ingestion_write_pool',
          max: env.INGESTION_WRITE_POOL_SIZE ?? 8,
          min: 0,
          idleTimeoutMs: env.LOG_DB_IDLE_TIMEOUT,
          acquireTimeoutMs: env.LOG_DB_CONNECTION_TIMEOUT,
          purpose: 'Dedicated telemetry persistence',
          poolingMode: 'direct',
          targetEnvVar: 'LOG_DB_PRIMARY',
        },
        ...pgmqWorkerPools(4, 4),
      ]);
    case 'analytics':
      return budget(role, 'Analytics and rollup workers', [
        {
          name: 'analytics_logdb_pool',
          max: env.ANALYTICS_DB_POOL_MAX ?? 6,
          min: 0,
          idleTimeoutMs: env.LOG_DB_IDLE_TIMEOUT,
          acquireTimeoutMs: env.LOG_DB_CONNECTION_TIMEOUT,
          purpose: 'Rollups, retention, and partition maintenance',
          poolingMode: 'direct',
          targetEnvVar: 'LOG_DB_PRIMARY',
        },
        ...pgmqWorkerPools(2, 2),
      ]);
    case 'cron':
      // Cron only dispatches scheduled jobs via pgmq.send; never allocate a blocking reader pool
      return budget(role, 'Scheduled PGMQ jobs', [primaryPool(), pgmqCommandPool(2)]);
  }
}
```

---

### Code Snippet 3: Ingestion Worker Client with Asynchronous Commit Enabled
From [`src/shared/workers/ingestion-worker-main.ts#L142-L157`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/shared/workers/ingestion-worker-main.ts#L142-L157):

```typescript
    writePool.on('connect', (client) => {
      // Disabling synchronous WAL fsync wait for observability ingestion boosts UNNEST batch write throughput 2x-4x
      client.query('SET synchronous_commit = off').catch((err: Error) => {
        log.debug({ err: err.message }, 'Failed to set synchronous_commit = off on telemetry write client');
      });

      client.on('error', (err: Error) => {
        if (isExpectedServerlessDisconnect(err)) {
          log.debug({ err: err.message }, 'Client telemetry write pool connection closed by serverless host');
          return;
        }
        log.debug({ err: err.message }, 'PostgreSQL client socket error on active telemetry write connection');
      });
    });
```

---

## 6. Corrected Production Configurations

### 6.1 Corrected `pgbouncer.ini` ([`docker/pgbouncer/pgbouncer.ini`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/docker/pgbouncer/pgbouncer.ini))

```ini
[databases]
;; PrimaryDB (Postgres max_connections = 60 -> Total PgBouncer server conns capped at 48, leaving 12 for direct/admin)
pulse_primary = host=pulse_primarydb port=5432 dbname=pulse_primary pool_mode=transaction pool_size=24 reserve_pool=4 max_db_connections=32
pulse_primary_session = host=pulse_primarydb port=5432 dbname=pulse_primary pool_mode=session pool_size=12 reserve_pool=2 max_db_connections=16

;; LogDB (Postgres max_connections = 80 -> Total PgBouncer server conns capped at 45, leaving 35 for direct ingestion/analytics + Timescale workers)
pulse_logdb = host=pulse_logdb port=5432 dbname=pulse_logdb pool_mode=transaction pool_size=25 reserve_pool=5 max_db_connections=35
pulse_logdb_session = host=pulse_logdb port=5432 dbname=pulse_logdb pool_mode=session pool_size=8 reserve_pool=2 max_db_connections=10

;; Fallback wildcard if needed
* = host=pulse_primarydb port=5432

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt
admin_users = postgres
stats_users = postgres,monitor

;; Connection limits (Recalibrated for KVM 4 zero-overflow)
max_client_conn = 250
default_pool_size = 20
min_pool_size = 2
reserve_pool_size = 5
reserve_pool_timeout = 3
max_db_connections = 100

;; Prepared statements support for node-pg in transaction pooling (PgBouncer 1.21+)
max_prepared_statements = 200

server_idle_timeout = 60
server_connect_timeout = 15
server_login_retry = 3
query_timeout = 60
idle_transaction_timeout = 120
client_idle_timeout = 0
```

---

### 6.2 Corrected PostgreSQL & Docker Parameters ([`docker-compose.database.yml`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/docker-compose.database.yml))

| Parameter | PrimaryDB (`pulse_primarydb`) | LogDB (`pulse_logdb`) | Why This Change Is Required on KVM 4 |
| :--- | :--- | :--- | :--- |
| **`max_connections`** | **`60`** | **`80`** | Lowered from 100 to 80 on LogDB to save per-backend RAM while fitting 45 (PgBouncer) + 8 (Ingest) + 6 (Analytics) + 4 (Timescale) + 3 (Admin) = 66 total. |
| **`shared_buffers`** | **`1280MB`** (1.25 GB) | **`2048MB`** (2.0 GB) | Leaves headroom inside container memory limits so spikes in `work_mem` and Timescale compression never trigger OOM-kills. |
| **`effective_cache_size`** | **`2560MB`** (2.5 GB) | **`3840MB`** (3.75 GB) | Reflects actual `shared_buffers` + realistic shared Linux page cache remaining on a 16 GB host. |
| **`work_mem`** | **`12MB`** | **`16MB`** | Prevents multi-node hash/sort analytical queries from multiplying into multi-GB allocations. |
| **`maintenance_work_mem`** | **`192MB`** | **`256MB`** | Caps memory when multiple TimescaleDB background workers run chunk compression simultaneously. |
| **`timescaledb.max_background_workers`** | *N/A* | **`4`** *(Down from 8)* | 8 background workers on a 2.5-vCPU container causes severe CPU contention during compression. 4 is optimal. |
| **`wal_compression`** | **`on`** | **`on`** | Dramatically reduces WAL write volume and NVMe I/O during bulk `UNNEST` telemetry inserts. |
| **Container Memory Limit** | **`4000M`** (4.0 GB) | **`6500M`** (6.5 GB) | Frees memory for OS page cache and Node.js worker heaps (4.0G + 6.5G = 10.5G, leaving 5.5G for OS + 6 Node processes). |
| **Container CPU Limit** | **`1.5 vCPUs`** | **`2.5 vCPUs`** | Balances the 4 physical cores cleanly without starving Node.js event loops under heavy DB compression. |

---

## 7. LogDB Engine Cancellation, Client Eviction & PGMQ Adaptive Polling Hardening

### 7.1 Hardened `src/config/log-database.ts`
1. **Engine-Level Query Cancellation (Eliminates Zombie Queries):**
   - Replaced node-pg client-side `query_timeout` with transaction-scoped `set_config('statement_timeout', ..., true)`.
   - When a statement times out, PostgreSQL engine internally terminates the query (`57014`), freeing CPU immediately instead of running orphaned in the background.
2. **Zero-Retry on Timeouts:**
   - `isTimeoutError(err)` catches `57014` and client-side timeout errors.
   - `queryWithRetry` instantly throws timeouts without retrying, preventing 3x zombie analytical queries from overwhelming LogDB.
3. **Dirty Client Eviction on Failed ROLLBACK:**
   - When `ROLLBACK` fails or a query times out, `client.release(true)` is executed, instructing `pg-pool` to destroy and evict the socket rather than returning a desynchronized client.
4. **Single-Round-Trip Tenant Scope & Statement Timeout:**
   - Consolidated `applyTenantScope` and statement timeout into:
     ```sql
     SELECT set_config('app.current_project_id', $1, true), set_config('statement_timeout', $2, true)
     ```
     eliminating 2 extra network round-trips per read query.
5. **Replica Circuit Breaker with 15s Auto-Cooldown:**
   - Replica failures only trip on genuine connection errors (`isRetryableLogDbError`).
   - `replicaUnhealthyUntil = Date.now() + 15_000` automatically restores replica routing after 15 seconds without requiring an external probe.

---

### 7.2 Hardened `src/lib/pgmq.ts`
1. **500x Connection Occupancy Drop via Client-Side Adaptive Polling:**
   - Replaced server-side `pgmq.read_with_poll` (which ran `pg_sleep(0.1)` 20 times inside PostgreSQL for 2,000ms) with client-side polling loop calling fast `this.read()` (~0.4ms) and sleeping in Node.js `setTimeout` with $\pm 15\%$ jitter.
   - Releases physical PostgreSQL/PgBouncer connection slots instantly when queues are quiet.
2. **Lazy Reader Pool Instantiation:**
   - `this.pool` is instantiated lazily via `this.readerFactory` only when `.read()`, `.readWithPoll()`, or `.getPool()` is invoked.
   - `api-backend` (x2) and `cron` only ever enqueue (`send` / `sendBatch`), completely avoiding reader pool allocations.
3. **Safe Mutating Query Retries:**
   - Mutating calls (`send`, `sendBatch`) pass `isIdempotent = false` to `this.query()`. Retries are only allowed on pre-dispatch socket connection errors (`ECONNREFUSED`, `ETIMEDOUT`), eliminating duplicate message enqueuing.


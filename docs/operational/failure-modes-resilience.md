# Operational Failure Modes & Resilience Architecture

## 1. System Role & Responsibilities

The Resilience and Failure Recovery subsystem shields Pulse's services against cascade failures, database socket exhaustion, event-loop starvation, memory leaks, third-party webhook outages, and poison-pill messages.

### What the Subsystem Does
- **Tiered Admission Control & Load Shedding**: Automatically monitors event loop delay (EWMA-smoothed via `monitorEventLoopDelay`), event loop utilization (`ELU`), heap memory, and resident set size (`RSS`) in [`src/lib/admission-control.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/lib/admission-control.ts). Sheds high-volume sheddable telemetry requests first with `429 Too Many Requests` (`Retry-After: 5`) while strictly preserving critical health, authentication, and billing routes.
- **Database Socket & Transient Disconnect Resilience**: Classifies PostgreSQL errors into transient vs. fatal codes in [`src/config/postgres-ssl.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/config/postgres-ssl.ts), executing automatic 3-attempt exponential retries with jitter for serverless socket teardowns, connection timeouts, and `53300: too_many_connections`.
- **Split-Brain Mitigation via Heartbeat Guard**: In [`src/lib/pgmq-worker.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/lib/pgmq-worker.ts), actively tracks background `setVt` heartbeat responses. If 3 consecutive heartbeats fail or elapsed time reaches $0.75 \times \text{visibilityTimeout}$, an `AbortController` terminates local task execution before the lock in PostgreSQL expires.
- **Poison-Pill Detection & Transactional DLQ Routing**: Detects messages exceeding `maxAttempts` (`read_ct > maxAttempts`) and transactionally routes them to dead-letter queues within a single PostgreSQL transaction (`BEGIN ... COMMIT`), preventing infinite retry loops and message loss.
- **Outbound Connector Circuit Breakers**: Protects worker threads from hanging third-party destinations (Slack, Discord, webhooks) via [`src/modules/connectors/runtime-global-guards.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/connectors/runtime-global-guards.ts), maintaining a 3-state circuit breaker (`closed` $\to$ `open` $\to$ `half_open`).
- **Continuous Heap & Memory Diagnostics**: Samples memory growth trends via [`src/lib/memory-diagnostics.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/lib/memory-diagnostics.ts), detecting sustained multi-sample heap growth ($\ge 20\%$ across 3 consecutive checks) to distinguish memory leaks from benign GC variance.

### What the Subsystem Does NOT Do
- **Blind Drop of Critical Traffic**: Never drops health probes, login/session verification, or Stripe payment webhooks during load shedding.
- **Unbounded In-Memory Queuing**: Does not buffer shed requests in local Node.js process memory; rejected requests receive immediate HTTP 429 backpressure responses instructing clients to back off.

---

## 2. Code Traceability Map

| Resilience Subsystem | Source File Path | Key Classes / Functions | Primary Responsibility |
| :--- | :--- | :--- | :--- |
| **Admission Controller** | [`src/lib/admission-control.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/lib/admission-control.ts) | `EnterpriseAdmissionController`, `classifyRequestTier` | EWMA event-loop delay smoothing, multi-sample sustained breach detection, tiered traffic classification (`CRITICAL`, `STANDARD`, `SHEDDABLE`). |
| **Transient Error Classifier** | [`src/config/postgres-ssl.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/config/postgres-ssl.ts) | `isTransientPostgresError` | Identifies retryable serverless disconnects, PgBouncer terminations, and serialization failures. |
| **Primary DB Retry Wrapper** | [`src/config/database.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/config/database.ts) | `pool.query` retry proxy | Injects automatic 3-attempt backoff into primary PostgreSQL connection pools. |
| **Log DB Dual-Pool Manager** | [`src/config/log-database.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/config/log-database.ts) | `LogDatabaseManager.queryWithRetry` | Asymmetric timeout enforcement (writes unbounded, reads bounded), read replica failover to primary. |
| **Worker Heartbeat & DLQ** | [`src/lib/pgmq-worker.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/lib/pgmq-worker.ts) | `executeJob`, `handleDeadLetter`, `stop` | Heartbeat abort guard, active exponential backoff via `setVt`, transactional DLQ eviction, graceful draining. |
| **Connector Circuit Breakers** | [`src/modules/connectors/runtime-global-guards.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/connectors/runtime-global-guards.ts) | `ConnectorGlobalGuards` | Atomic token-bucket rate limits and `closed`/`open`/`half_open` circuit state machine. |
| **Memory Diagnostics** | [`src/lib/memory-diagnostics.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/lib/memory-diagnostics.ts) | `MemoryDiagnostics`, `captureMemorySnapshot` | Multi-sample sustained heap growth detection, post-GC deltas, and memory leak warnings. |
| **Ingestion Fairness Gate** | [`src/modules/ingestion/workers/worker-registry.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/ingestion/workers/worker-registry.ts) | `WorkerRegistry.runOne` | Per-org in-flight quota limits, delayed PGMQ re-enqueuing, starvation guard auto-admission. |

---

## 3. Data Flow & Sequence Diagram

The following sequence illustrates system behavior under elevated event-loop delay, showing tiered load shedding and fast recovery:

```mermaid
sequenceDiagram
    autonumber
    participant ClientSDK as Client Telemetry SDK
    participant UserBrowser as User Browser (Dashboard)
    participant AuthUser as User Logging In
    participant Admission as EnterpriseAdmissionController
    participant Fastify as Fastify Routing Engine

    loop Every 500ms (samplingIntervalMs)
        Admission->>Admission: Sample monitorEventLoopDelay() & ELU
        Admission->>Admission: Compute EWMA smoothedDelayMs
        Admission->>Admission: Update AdmissionPressureState (HEALTHY -> ELEVATED)
    end

    Note over Admission: Event loop delay > 1500ms for 2 consecutive samples (ELEVATED)

    par Ingestion Telemetry Request
        ClientSDK->>Fastify: POST /api/v1/telemetry
        Fastify->>Admission: onRequest Hook: evaluate(req)
        Admission->>Admission: classifyRequestTier(url) -> SHEDDABLE
        Admission-->>ClientSDK: HTTP 429 Too Many Requests (Retry-After: 5)
        Note over ClientSDK: SDK buffers events locally and backs off
    and Standard Dashboard Request
        UserBrowser->>Fastify: GET /api/projects
        Fastify->>Admission: onRequest Hook: evaluate(req)
        Admission->>Admission: classifyRequestTier(url) -> STANDARD
        Admission->>Fastify: Admitted (Not saturated yet)
        Fastify-->>UserBrowser: HTTP 200 OK
    and Critical Auth Request
        AuthUser->>Fastify: POST /auth/login
        Fastify->>Admission: onRequest Hook: evaluate(req)
        Admission->>Admission: classifyRequestTier(url) -> CRITICAL
        Admission->>Fastify: Admitted unconditionally
        Fastify-->>AuthUser: HTTP 200 OK (Session Issued)
    end

    Note over Admission: Ingestion sheds reduce CPU load; smoothed delay drops < 1500ms
    Admission->>Admission: State transitions back to HEALTHY
    ClientSDK->>Fastify: POST /api/v1/telemetry (Retry after 5s)
    Fastify->>Admission: evaluate(req) -> Admitted
    Fastify-->>ClientSDK: HTTP 202 Accepted
```

---

## 4. Payloads & Data Contracts

### 4.1 Admission Pressure States
Defined in [`src/lib/admission-control.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/lib/admission-control.ts#L26-L37):

```typescript
export enum RequestTier {
  CRITICAL = 'critical',    // Health probes, Auth routes, Billing webhooks (Never shed)
  STANDARD = 'standard',    // General REST APIs, dashboards, project CRUD
  SHEDDABLE = 'sheddable',  // Ingestion endpoints (/api/v1/telemetry, /api/v1/ingest)
}

export enum AdmissionPressureState {
  HEALTHY = 'HEALTHY',      // Normal operations; all requests admitted
  ELEVATED = 'ELEVATED',    // Delay > 1500ms: Sheds SHEDDABLE tier immediately
  SATURATED = 'SATURATED',  // Delay > 3500ms OR Memory > 420MB: Sheds SHEDDABLE + STANDARD
  EMERGENCY = 'EMERGENCY',  // Critical failure; only CRITICAL tier admitted
}
```

### 4.2 Circuit Breaker State Contract
Defined in [`src/modules/connectors/runtime-global-guards.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/connectors/runtime-global-guards.ts#L3-L8):

```typescript
export interface GlobalGuardDecision {
  allowed: boolean;                                     // True if outbound request is permitted
  circuitState: 'closed' | 'open' | 'half_open';        // Current connector health state
  remainingTokens: number;                              // Remaining token bucket capacity
  usedFallback: boolean;                                // True if database guard query timed out
}
```

---

## 5. Comprehensive Failure Modes Matrix

| Failure Mode / Scenario | Root Cause | Immediate Symptoms | Automated Detection & Mitigation | Recovery Procedure |
| :--- | :--- | :--- | :--- | :--- |
| **PostgreSQL Connection Exhaustion (`53300`)** | Burst in API traffic or stuck analytics queries. | `error: too_many_connections` raised on query checkout. | Dual-datastore pool isolation (`pool`, `notificationPool`, `log_primary`, `log_replica`) bounds socket footprint. `isTransientPostgresError` retries 3x with exponential backoff ($150\text{ms} \times \text{attempt}$). | Inspect active connections with `SELECT count(*), state FROM pg_stat_activity GROUP BY state;`. Verify pool maximums against DB `max_connections`. |
| **Ingestion Worker Split-Brain** | Worker execution stalled by event-loop freeze or heavy GC while holding claimed message. | Message visibility timeout (`vt`) expires in PostgreSQL; second worker claims message and runs duplicates. | Background heartbeat loop in `PgmqWorker` tracks `setVt`. If 3 consecutive heartbeats fail or elapsed time $\ge 0.75 \times \text{vt}$, `AbortController.abort()` cancels ongoing local queries before lock expires. | System recovers automatically. Investigate event-loop delay or long-running synchronous code in worker handlers. |
| **Poison-Pill Messages** | Malformed JSON or unparseable event causing unhandled exception in worker. | Message repeatedly fails, gets redelivered, and consumes worker CPU indefinitely. | `PgmqWorker` checks `job.readCt > maxAttempts` (default: 5) at start of processing. Automatically bypasses business handler and routes message transactionally to DLQ. | Inspect dead-letter jobs in `ingestion_dead_letter_jobs` or queue `pgmq.q_<queue>_dlq`. Fix bug or drop poison payload. |
| **External Webhook Latency Spikes** | Customer webhook endpoint experiences downtime or hangs on HTTP requests. | Worker sockets become tied up waiting for HTTP responses, exhausting outbound delivery capacity. | `ConnectorGlobalGuards` tracks consecutive failures. After 5 failures, circuit trips to `open` for 60s. Outbound jobs fail fast immediately without making network requests. | Circuit automatically enters `half_open` after 60s, probing the destination with a single request. If successful, resets to `closed`. |
| **V8 Heap Memory Pressure / Leak** | Telemetry ingestion payload buffering or unbounded in-memory cache growth. | Process RSS and heap usage expand towards container cgroup memory limits. | `EnterpriseAdmissionController` triggers `SATURATED` state when heap exceeds `PRESSURE_MAX_HEAP_MB` (420MB), shedding sheddable traffic. `MemoryDiagnostics` logs sustained growth warnings. | Inspect heap snapshot via `/diagnostics/memory`. Ensure large objects are unreferenced and not pinned in global maps. |
| **Database Read Replica Failure** | Log DB read replica restarts or loses network connectivity. | Dashboard queries raise connection or network timeout errors. | `LogDatabaseManager.getConnection` marks replica unhealthy and transparently routes read queries to `primaryPool`. | Once replica passes health check, `LogDatabaseManager` resumes routing reads to the replica automatically. |
| **Managed DB Idle Socket Drop** | Neon / PgBouncer serverless pooler closes idle socket after inactivity. | First query on borrowed client raises `ECONNRESET` or socket closed error. | `isTransientPostgresError` detects serverless disconnect, discards dead socket, checks out fresh client, and retries query. | Fully automated and transparent to application callers. |

---

## 6. Configuration Parameters

The following parameters in [`src/config/env.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/config/env.ts) configure resilience and fault tolerance:

| Parameter | Type | Default | Operational Impact & Production Guidance |
| :--- | :--- | :--- | :--- |
| `PRESSURE_MAX_EVENT_LOOP_DELAY_MS` | `number` | `1500` | EWMA smoothed delay (ms) triggering `ELEVATED` load shedding of sheddable telemetry. |
| `PRESSURE_CRITICAL_EVENT_LOOP_DELAY_MS` | `number` | `3500` | Critical delay (ms) triggering `SATURATED` load shedding of standard REST API routes. |
| `PRESSURE_MAX_EVENT_LOOP_UTILIZATION` | `number` | `0.95` | Event loop utilization ceiling (0.95 = 95% busy). |
| `PRESSURE_MAX_HEAP_MB` | `number` | `420` | V8 Heap ceiling before triggering protective admission shedding. |
| `PRESSURE_MAX_RSS_MB` | `number` | `768` | Resident Set Size ceiling before triggering protective admission shedding. |
| `PRESSURE_CONSECUTIVE_BREACHES` | `number` | `2` | Number of consecutive sampling intervals above threshold required before shedding kicks in. |
| `PRESSURE_SAMPLING_INTERVAL_MS` | `number` | `500` | Sampling cadence for event loop histogram and ELU calculation. |
| `LOG_RETRIES` | `number` | `3` | Maximum retry attempts for transient Log DB errors before failing query. |
| `CONNECTOR_CIRCUIT_FAILURE_THRESHOLD` | `number` | `5` | Number of consecutive delivery failures before tripping connector circuit breaker. |
| `CONNECTOR_CIRCUIT_RESET_SECONDS` | `number` | `60` | Duration connector circuit breaker remains `open` before probing recovery in `half_open`. |
| `SHUTDOWN_TIMEOUT_MS` | `number` | `20000` | Maximum time allowed for graceful process shutdown before forceful exit. |

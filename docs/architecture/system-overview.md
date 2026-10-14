# System Architecture & Topology Overview

## 1. Executive Summary & System Role

Pulsiv is an enterprise-grade observability and SaaS telemetry backend designed for high-throughput event ingestion, distributed tracing, error tracking, real-time alerting, and multi-tenant billing metering.

The architecture is built on a **split-plane dual-datastore design**:
- **Control & Auth Plane (Primary DB):** Handles tenant isolation, authentication, session lifecycle, RBAC, billing entitlements, and message broker queues (via PostgreSQL PGMQ).
- **Telemetry Data Plane (Dedicated Log DB / TimescaleDB):** Handles append-only partitioned telemetry ingestion (`events_requests`, `events_errors`, `events_logs`, `events_traces`, etc.), error group clustering, and multi-resolution analytical rollups.

```
                              ┌─────────────────────────────────────────┐
                              │      Client SDKs / HTTP Producers       │
                              └────────────────────┬────────────────────┘
                                                   │ HTTPS / TLS
                                                   ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│                             API Gateway Cluster (Fastify v5)                                   │
│  ┌───────────────────────┐   ┌───────────────────────────┐   ┌──────────────────────────────┐  │
│  │  Admission Controller │   │ Authenticated REST APIs   │   │ High-Throughput Ingestion    │  │
│  │  (EWMA Load Shedding) │   │ (Auth, Projects, Billing) │   │ (/v1/ingest, /v1/ingest/*)   │  │
│  └───────────────────────┘   └─────────────┬─────────────┘   └──────────────┬───────────────┘  │
└────────────────────────────────────────────┼────────────────────────────────┼──────────────────┘
                                             │                                │
                       Metadata & Auth Reads │           PGMQ Enqueue         │ Chunks (500 events)
                                             ▼                                ▼
                         ┌──────────────────────────────┐    ┌──────────────────────────────────┐
                         │ Primary Database (PostgreSQL)│    │ PGMQ Broker (PostgreSQL Schema)  │
                         │ • Users, Orgs, Sessions      │    │ • ingest_request, ingest_error   │
                         │ • API Keys, Subscriptions    │    │ • alert_evaluate_fast, etc.      │
                         └──────────────┬───────────────┘    └────────────────┬─────────────────┘
                                        │                                     │
                                        │                      Worker Dequeue │ (PgmqWorker Loop)
                                        │                                     ▼
┌───────────────────────────────────────┴────────────────────────────────────────────────────────┐
│                              Dedicated Worker Tiers (Forked Daemons)                           │
│  ┌───────────────────────┐   ┌───────────────────────────┐   ┌──────────────────────────────┐  │
│  │ Ingestion Workers (v2)│   │ Alert Evaluation Workers  │   │ Background / Cron Workers    │  │
│  │ (EventProcessor,      │   │ (Engines, Notification    │   │ (Quota flushes, Retention    │  │
│  │  TelemetryWriter)     │   │  Router, Escalation)      │   │  sweeps, DLQ intake)         │  │
│  └───────────┬───────────┘   └─────────────┬─────────────┘   └──────────────────────────────┘  │
└──────────────┼─────────────────────────────┼───────────────────────────────────────────────────┘
               │ Set-based UNNEST Inserts    │ Incident Records / Dispatches
               ▼                             ▼
┌──────────────────────────────────────────────────────────────┐    ┌───────────────────────────┐
│ Dedicated Telemetry Datastore (TimescaleDB / Hypertable DB)  │    │ External Notification Sinks│
│ • events_requests, events_errors, events_logs, events_traces │    │ • SMTP Email Engine       │
│ • Partitioned daily by occurred_at                           │    │ • Webhooks (SSRF-hardened)│
│ • analytics_error_groups, analytics_hourly_rollup            │    │ • Slack, Discord, PagerD  │
└──────────────────────────────────────────────────────────────┘    └───────────────────────────┘
```

---

## 2. Code Traceability Map

| Conceptual Component | Implementation File | Key Classes / Functions | Operational Responsibility |
| :--- | :--- | :--- | :--- |
| **API Entry Point** | [`src/main.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/main.ts) | `startServer()` | Boots Fastify HTTP server, registers shutdown hooks, connects datastores. |
| **App Assembly & Routing** | [`src/app.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/app.ts) | `buildApp()` | Initializes middleware, admission controller, OpenAPI specs, route prefixes. |
| **Admission Control** | [`src/lib/admission-control.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/lib/admission-control.ts) | `EnterpriseAdmissionController` | EWMA event-loop delay smoothing, tiered priority-aware load shedding (`CRITICAL`, `STANDARD`, `SHEDDABLE`). |
| **Primary Datastore Pool** | [`src/config/database.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/config/database.ts) | `pool`, `notificationPool`, `withTransaction()` | Primary PostgreSQL connection pool management with transient `53300` retry logic. |
| **Log Datastore Manager** | [`src/config/log-database.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/config/log-database.ts) | `logDB`, `LogDatabaseManager` | Primary/Replica routing, TimescaleDB hypertable setups, read/write split. |
| **Ingestion Gateway** | [`src/modules/ingestion/service.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/ingestion/service.ts) | `IngestionService.processIngest()` | API key validation, quota pre-checks, event validation, chunking into PGMQ jobs. |
| **Message Broker Driver** | [`src/lib/pgmq.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/lib/pgmq.ts) | `PgmqClient` | High-level TypeScript client for PostgreSQL PGMQ extension (`read`, `send`, `delete`, `set_vt`). |
| **Queue Consumer Engine** | [`src/lib/pgmq-worker.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/lib/pgmq-worker.ts) | `PgmqWorker` | Worker polling loop, visibility heartbeats, exponential retry backoff, transactional DLQ routing. |
| **Ingestion Worker Tier** | [`src/shared/workers/ingestion-worker-main.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/shared/workers/ingestion-worker-main.ts) | `IngestionWorkerProcess` | Dedicated OS process hosting `WorkerRegistry` for draining telemetry queues. |
| **Telemetry Write Pipeline** | [`src/modules/ingestion/pipeline/telemetry-writer.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/ingestion/pipeline/telemetry-writer.ts) | `TelemetryWriter` | Set-based batch inserts into partitioned tables with `ON CONFLICT DO NOTHING`. |
| **Alerting Queue Engine** | [`src/modules/alerting/queue.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/queue.ts) | `registerAlertingWorkers()` | Alert evaluation workers, notification router, escalation sweep workers. |
| **Connector Delivery Tier**| [`src/modules/connectors/queue.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/connectors/queue.ts) | `registerConnectorWorkers()` | Dispatches emails, webhooks, and chat notifications with atomic circuit breakers. |

---

## 3. Technology Stack & Runtime Specifications

| Layer | Technology | Version / Specification | Rationale |
| :--- | :--- | :--- | :--- |
| **Runtime Environment** | Node.js | `>= 20.0.0 LTS` | Native `fetch`, `crypto.subtle`, `node:perf_hooks`, V8 engine optimizations. |
| **Web Framework** | Fastify | `^5.2.1` | Extreme throughput, asynchronous request pipeline, low JSON serialization overhead. |
| **Schema Validation** | Zod / Type Provider | `zod ^3.24.2`, `fastify-type-provider-zod` | Compile-time and runtime type safety with zero manual type casts. |
| **Primary Relational Store**| PostgreSQL | `16+` (Managed / Neon / Supabase) | ACID relational guarantees for Auth, Organizations, Billing, and Metadata. |
| **Queue Subsystem** | Supabase PGMQ | `pgmq` Extension | ACID message queue implemented directly inside PostgreSQL, eliminating external broker overhead (RabbitMQ/Kafka) for early-to-mid scale. |
| **Telemetry Datastore** | PostgreSQL / TimescaleDB | Hypertables / Partitioned by Range | High-volume write throughput, daily partitions on `occurred_at`, compressed columnar storage. |
| **Process Manager** | PM2 | `ecosystem.config.cjs` | Multi-core CPU cluster scaling, automatic process recovery, RSS memory ceiling monitoring. |
| **Metrics & Tracing** | Prometheus / Prom-Client | `prom-client ^15.1.3` | Native `/metrics` scraping with pre-allocated status code strings and bounded route cardinality. |

---

## 4. Process Model & Concurrency Architecture

The system executes as decoupled, isolated operating system processes configured in [`ecosystem.config.cjs`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/ecosystem.config.cjs):

1. **`api-backend` (Cluster Mode):**
   - Runs `dist/main.js` across $N$ CPU cores (`API_INSTANCES`, defaults to 1 or $\min(\text{CPUs}, 4)$).
   - Only processes incoming HTTP requests, performs admission control, validates auth, and enqueues tasks into PGMQ.
   - Enforces `--max-old-space-size=512` memory ceiling per worker.
2. **`ingestion-workers` (Fork Mode):**
   - Runs `dist/shared/workers/ingestion-worker-main.js`.
   - Spins up 12 dedicated `PgmqWorker` instances (one per event type: `ingest_request`, `ingest_error`, etc.).
   - Sized by `INGESTION_WRITE_POOL_SIZE = 24` with `INGESTION_WRITE_CONCURRENCY = 16`.
3. **`alert-workers` (Fork Mode):**
   - Runs `dist/shared/workers/alert-workers-main.js`.
   - Consumes rule evaluations (`alert_evaluate_fast`, `alert_evaluate_window`) and dispatches notifications.
4. **`background-workers` (Fork Mode):**
   - Runs `dist/shared/workers/main.js`.
   - Handles crons, data retention cleanups, dead-letter retries, and rate limit bucket sweeps.

---

## 5. Security & Isolation Boundaries

- **Tenant Isolation:** Every operational query is tenant-scoped by `organization_id` and `project_id`. Ingested events resolve tenant identifiers strictly from the authenticated API Key secret hash, never from user-supplied JSON payload fields.
- **Network Boundaries:** Outbound connector notifications (webhooks) execute through an SSRF-hardened HTTP client ([`src/shared/utils/ssrf.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/shared/utils/ssrf.ts)) that blocks private IP ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.1`, `::1`) and cloud metadata endpoints (`169.254.169.254`).
- **Cryptographic Independence:** The system asserts at boot that all crypto secrets (`JWT_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET`, `AUTH_TOKEN_SECRET`, `ENCRYPTION_KEY`) are distinct 32+ character keys via [`assertSecretsAreDistinct()`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/config/env.ts#L471).

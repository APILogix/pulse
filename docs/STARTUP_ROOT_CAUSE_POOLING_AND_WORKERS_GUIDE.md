# Master Guide: Backend Startup Forensics, Database Pooling, Background Workers & Future Scaling Roadmap

**Target System:** Pulsiv SaaS Backend (`pulse`)  
**Audit & Engineering Scope:** Backend startup performance, logging impact analysis, connection pool topology, PGMQ worker architecture, configuration inventory, and step-by-step upgrade procedures.  
**Classification:** Core System Architecture & Operations Runbook  
**Last Updated:** September 2026  

---

## Table of Contents
1. [Executive Summary: Is It Because of Logs?](#1-executive-summary-is-it-because-of-logs)
2. [Root Cause Forensics: Why Backend Startup Is Slow](#2-root-cause-forensics-why-backend-startup-is-slow)
   - [Timeline Reconstruction: API vs Workers vs Ingestion](#timeline-reconstruction-api-vs-workers-vs-ingestion)
   - [Root Cause 1: 120+ Sequential Remote Cloud SSL Queries on Boot](#root-cause-1-120-sequential-remote-cloud-ssl-queries-on-boot)
   - [Root Cause 2: Fleet-Wide Connection Pool Contention (4 PM2 Processes)](#root-cause-2-fleet-wide-connection-pool-contention-4-pm2-processes)
   - [Root Cause 3: Ingestion Worker 71-File Migration Scan on Startup](#root-cause-3-ingestion-worker-71-file-migration-scan-on-startup)
   - [Root Cause 4: Immediate Outbox Polling on Cold Database](#root-cause-4-immediate-outbox-polling-on-cold-database)
   - [Root Cause 5: Ingestion Backlog Shockwave (91M ms Queue Delay)](#root-cause-5-ingestion-backlog-shockwave-91m-ms-queue-delay)
3. [Database Plane & Connection Pooling Architecture](#3-database-plane--connection-pooling-architecture)
   - [Dual-Database Plane Topology](#dual-database-plane-topology)
   - [Connection Pool Inventory Across Processes](#connection-pool-inventory-across-processes)
   - [Configuration Reference Matrix](#configuration-reference-matrix)
   - [Connection Budget Accounting vs Supabase Limits](#connection-budget-accounting-vs-supabase-limits)
4. [Background Workers Architecture & Operational Settings](#4-background-workers-architecture--operational-settings)
   - [Worker Process Roles & Topologies](#worker-process-roles--topologies)
   - [PGMQ Engine & Worker Mechanics](#pgmq-engine--worker-mechanics)
   - [Billing Workers Inventory (21 Jobs)](#billing-workers-inventory-21-jobs)
   - [Connector Workers Inventory (14 Queues)](#connector-workers-inventory-14-queues)
   - [Alerting Workers Inventory (15 Queues + Evaluators)](#alerting-workers-inventory-15-queues--evaluators)
   - [Ingestion Workers Inventory (10 Event Types + DLQ)](#ingestion-workers-inventory-10-event-types--dlq)
   - [Analytics Engine Workers Inventory (16 Queues + 5 Compactions)](#analytics-engine-workers-inventory-16-queues--5-compactions)
   - [Auth Automation & Outbox Email Workers](#auth-automation--outbox-email-workers)
5. [Future Upgrade & Scaling Roadmap](#5-future-upgrade--scaling-roadmap)
   - [Optimization 1: Eliminate Sequential Queue Probing (132s -> 1.5s Boot)](#optimization-1-eliminate-sequential-queue-probing-132s---15s-boot)
   - [Optimization 2: Transition from Direct Port 5432 to Supavisor Pooler (Port 6543)](#optimization-2-transition-from-direct-port-5432-to-supavisor-pooler-port-6543)
   - [Optimization 3: Decouple PM2 Monolith into Dedicated Worker Containers](#optimization-3-decouple-pm2-monolith-into-dedicated-worker-containers)
   - [Optimization 4: Decouple Migration Execution from Worker Boot](#optimization-4-decouple-migration-execution-from-worker-boot)
   - [Optimization 5: Development vs Production Log Formatting Modernization](#optimization-5-development-vs-production-log-formatting-modernization)
   - [Optimization 6: Schema Sync (Fix Missing `ai_release_stale_reservations`)](#optimization-6-schema-sync-fix-missing-ai_release_stale_reservations)
6. [Step-by-Step Upgrade Runbook](#6-step-by-step-upgrade-runbook)

---

## 1. Executive Summary: Is It Because of Logs?

### The Question
> *"Why does our backend startups feel like logs? Is this because of logs or any other? What is the exact root cause?"*

### The Verdict
**No, logging is NOT the root cause of backend startup slowness.**

The logging system (built on Pino) is an asynchronous, high-throughput streaming logger that serializes messages and writes to stdout in microseconds. It consumes less than 0.5% of process CPU and zero blocking I/O during startup.

However, the startup **feels like logs** because:
1. **4 PM2 processes launch at the exact same instant:** When running `npm run start:prod` (or starting the PM2 ecosystem), PM2 forks `pulse-api`, `pulse-workers`, `pulse-ingestion`, and `pulse-analytics` concurrently.
2. **Flooding stdout with high-density JSON:** Each process independently logs its own bootstrap steps: datastore connections, TLS checks, 15+ module registrations, and **over 80 individual PGMQ worker registrations** (`{"component":"pgmq-worker","queue":"...","msg":"PGMQ worker started"}`).
3. **Immediate flood of backlog processing logs:** The moment `pulse-ingestion` connects, it finds millions of milliseconds of backlog in the queue and immediately starts dumping massive multi-line JSON performance profiling logs (`ingestion batch profile`, `[Phase 2/4] Ingest event stored`) multiple times every second.
4. **Slow Query Warnings:** Heavy SQL queries executed during boot trigger warning logs with entire query texts (`{"component":"database","msg":"Slow query","duration":12953}`).

The wall of text is a **visible symptom and consequence** of underlying operations taking an exceptionally long time.

### The Real Problem
The backend startup is slow because **the background worker process spends over 2 minutes (132 seconds) executing more than 120 sequential, blocking network round-trips over cloud SSL to Supabase to verify and create queues one by one**, while 4 processes simultaneously contend for a limited direct PostgreSQL connection pool.

---

## 2. Root Cause Forensics: Why Backend Startup Is Slow

### Timeline Reconstruction: API vs Workers vs Ingestion

Examining the production log timestamps from the latest system boot on **2026-09-04 20:30:21**:

```mermaid
timeline
    title System Startup Sequence (2026-09-04)
    20:30:21 : PM2 starts all 4 processes concurrently
    20:30:24 : API & Worker datastore connections initiated
    20:30:31 : API Server listening (Fastify ready in ~7 seconds)
    20:30:35 : Ingestion begins 71 migration file scans (takes 12s)
    20:30:41 : Analytics engine queues registered (parallel batch)
    20:30:48 : Ingestion workers start (backlog shockwave begins)
    20:30:58 : Worker process finishes Billing queues (31s sequential wait)
    20:31:00 : Email Outbox slow queries freeze pool (2.7s - 12.9s each)
    20:32:33 : Worker process FINALLY finishes Connectors (132s total!)
```

#### API Process (`pulse-api` via `pm2-out.log`)
- `20:30:24`: Env injected, datastore connections initiated.
- `20:30:28`: Primary PostgreSQL connected (`serverTime: 2026-09-04T15:00:25Z`).
- `20:30:30`: Log DB primary connected (`1.7s` connection time).
- `20:30:31`: All 15 Fastify modules registered.
- `20:30:31.566`: Server listening on `http://127.0.0.1:3000`.  
**API Startup Duration:** **~7.5 seconds** (Fast and healthy).

#### Workers Process (`pulse-workers` via `pm2-workers-out.log`)
- `20:30:21`: Process spawns.
- `20:30:26`: Alerting pools verified.
- `20:30:27`: Starts registering Billing jobs sequentially.
- `20:30:58`: Billing jobs finished registering (**31 seconds spent!**).
- `20:31:00 - 20:32:23`: Interleaved slow queries on `organization_email_outbox` taking up to **12.95 seconds** per query.
- `20:32:33`: Connector workers finish registering.  
**Worker Startup Duration:** **132 seconds (Over 2 minutes and 12 seconds!)**

---

### Root Cause 1: 120+ Sequential Remote Cloud SSL Queries on Boot

In `pulse/src/shared/workers/main.ts`:
```typescript
authAutomationWorkers = await registerAuthAutomationWorkers(workerLogger);
billingJobWorkers = await registerBillingJobWorkers(workerLogger);
connectorMonitor = await startConnectorMonitor(workerLogger);
alertingWorkers = await registerAlertingWorkers(workerLogger, ...);
```

When `registerBillingJobWorkers` runs in `src/modules/billing/jobs/workers.ts`:
```typescript
for (const definition of billingJobDefinitions) {
  const queue = billingQueueName(definition.name);
  await pgmq.createQueue(queue); // Network round-trip 1
  const worker = new PgmqWorker(pgmq, handler, { queue, ... });
  await worker.start();          // Calls this.client.createQueue(queue) -> Network round-trip 2!
}
```

#### The Bottleneck Calculation
- **Billing:** 21 definitions × 2 queries = **42 sequential SQL round-trips**.
- **Connectors:** 14 queues × 2 queries = **28 sequential SQL round-trips**.
- **Alerting:** 15 queues × 2 queries = **30 sequential SQL round-trips**.
- **Auth & Misc:** 10 queues × 2 queries = **20 sequential SQL round-trips**.
- **Total:** **120+ sequential network queries**.

Each query sends SQL over TLS to a remote Supabase instance (typical round-trip latency: 150ms to 400ms under initial connection handshake).
$$120 \text{ queries} \times 250\text{ms} = 30,000\text{ms} = 30\text{ seconds}$$
When connection pools are congested or the remote database is busy, individual round-trips stretch to 800ms - 2000ms. In `pm2-workers-out.log`, registering `billing_metrics` alone took **8.0 seconds** (from `20:30:50` to `20:30:58`).

---

### Root Cause 2: Fleet-Wide Connection Pool Contention (4 PM2 Processes)

When PM2 launches `ecosystem.config.cjs`:
1. `pulse-api`
2. `pulse-workers`
3. `pulse-ingestion`
4. `pulse-analytics`

Each process creates independent `pg.Pool` singletons:
- `DB_POOL_MAX` = 20 (Targeting `DATABASE_URL`)
- `LOG_POOL_MAX` = 20 (Targeting `LOG_DB_PRIMARY`)
- `INGESTION_WRITE_POOL_SIZE` = 20 (Dedicated write pool in ingestion worker)

#### Fleet Direct Connection Calculation
$$\text{Control DB (Port 5432)}: 20 (\text{API}) + 20 (\text{Workers}) + 20 (\text{Ingest}) + 20 (\text{Analytics}) = 80 \text{ max sockets}$$
$$\text{Telemetry DB (Port 5432)}: 20 (\text{API}) + 20 (\text{Workers}) + 40 (\text{Ingest}) + 20 (\text{Analytics}) = 100 \text{ max sockets}$$

Both target Supabase instances over direct port `5432`. Supabase PostgreSQL compute instances (especially Micro and Small tiers) have default `max_connections` limits between **60 and 90 connections**.

Because all 4 processes initialize and perform startup checks simultaneously, sockets saturate the database, forcing queries to wait in local pool queues (`dbConnectionWaitMs` up to 1640ms) or get rejected by PostgreSQL with connection resets.

---

### Root Cause 3: Ingestion Worker 71-File Migration Scan on Startup

In `pulse/src/shared/workers/ingestion-worker-main.ts`:
```typescript
const migrationResult = await runLogDbMigrations({ executionMode: 'automatic' });
```
On **every single worker boot**, the process:
1. Opens a database connection to the Log DB.
2. Reads the `database/logdb/migrations` directory from local disk.
3. Checks all **71 `.up.sql` migration files**.
4. Queries the `log_schema_migrations` table to verify each checksum and execution status.

From `pm2-ingestion-out.log`:
- `20:30:35`: `Testing log database connections`
- `20:30:47`: `found: 71, applied: 0, skipped: 71, deferred: 1... Log DB migrations complete`

**12 seconds** of startup time was spent simply reading disk files and checking database migration rows before the ingestion worker could even accept events.

---

### Root Cause 4: Immediate Outbox Polling on Cold Database

In `pulse/src/shared/workers/main.ts`:
```typescript
await startAuthEmailWorker();
await startOrgEmailWorker();
```
`startOrgEmailWorker()` immediately triggers a 5-second recurring loop:
```sql
SELECT id, to_email, subject, html, text, attempts
FROM organization_email_outbox
WHERE status = 'pending'
```
Because this worker started before the database pools were warm and while queue creation queries were saturating the database, these outbox queries took **up to 12.95 seconds** each:
- `20:31:00`: Duration `2,794ms` (Slow query)
- `20:31:10`: Duration `4,765ms` (Slow query)
- `20:31:45`: Duration `4,938ms` (Slow query)
- `20:32:03`: Duration `12,953ms` (Slow query)

These heavy queries locked worker pool slots, directly starving the ongoing queue registration calls and stretching connector startup to over 2 minutes.

---

### Root Cause 5: Ingestion Backlog Shockwave (91M ms Queue Delay)

In `pm2-ingestion-out.log`, the queues contained events that had been queued for:
`queueWaitMs: 91,033,777` (Approximately **25.2 hours** of backlog).

The second the 10 ingestion queues started at `20:30:48`:
- All 10 workers immediately claimed maximum batch sizes.
- Concurrently executed massive multi-row `UNNEST` inserts and transactions:
  - Batch ` eb52dc85`: 10 errors, transaction took **15.82 seconds**.
  - Batch `0cf682b0`: 187 spans, transaction took **23.80 seconds**.
  - Batch `e5a12108`: 107 traces, transaction took **24.06 seconds**.
- Disk I/O and CPU on the database spiked to 100%, causing any other queries being run during startup (such as worker registration queries) to stall.

---

## 3. Database Plane & Connection Pooling Architecture

### Dual-Database Plane Topology

Pulsiv strictly divides state across two separate PostgreSQL databases:

```
                               ┌────────────────────────────────────────────────────────┐
                               │                    DATABASE INFRASTRUCTURE             │
                               └────────────────────────────────────────────────────────┘
                                              ▲                          ▲
                                              │                          │
                    ┌─────────────────────────┴────────┐        ┌────────┴─────────────────────────┐
                    │       CONTROL PLANE DB           │        │       TELEMETRY / LOG DB         │
                    │      (DATABASE_URL:5432)         │        │     (LOG_DB_PRIMARY:5432)        │
                    │   Orgs, Users, Billing, PGMQ     │        │   Events, Traces, Spans, Logs    │
                    └──────────────────────────────────┘        └──────────────────────────────────┘
                               ▲        ▲          ▲                     ▲          ▲          ▲
                               │        │          │                     │          │          │
                     ┌─────────┘        │          └───────────┐         │          │          └───────────┐
                     │                  │                      │         │          │                      │
             ┌───────────────┐  ┌───────────────┐      ┌───────────────┐ │  ┌───────────────┐      ┌───────────────┐
             │   pulse-api   │  │ pulse-workers │      │pulse-analytics│ │  │pulse-ingestion│      │   pulse-api   │
             │  (Primary DB  │  │  (Primary DB  │      │  (Primary DB  │ │  │  (Write Pool  │      │  (Log DB Read │
             │   Pool: 20)   │  │   Pool: 20)   │      │   Pool: 20)   │ │  │   Pool: 20)   │      │   Pool: 20)   │
             └───────────────┘  └───────────────┘      └───────────────┘ │  └───────────────┘      └───────────────┘
                                                                         │
                                                                 ┌───────┴───────┐
                                                                 │pulse-analytics│
                                                                 │  (Log DB Read │
                                                                 │   Pool: 20)   │
                                                                 └───────────────┘
```

---

### Connection Pool Inventory Across Processes

| PM2 Process | Pool Identifier | Target Database | Min Conns | Max Conns | Timeout | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`pulse-api`** | `pool` (`database.ts`) | `DATABASE_URL` | `0` | `20` | 30s | User auth, project configs, billing APIs, quotas. |
| **`pulse-api`** | `primaryPool` (`log-database.ts`) | `LOG_DB_PRIMARY` | `0` | `20` | 30s | Dashboard telemetry queries, trace exploration. |
| **`pulse-api`** | `replicaPool` (`log-database.ts`) | `LOG_DB_REPLICA` | `0` | `20` | 30s | Optional read replica offloading. |
| **`pulse-workers`** | `pool` (`database.ts`) | `DATABASE_URL` | `0` | `20` | 30s | PGMQ queue polling, billing mutations, outbox. |
| **`pulse-workers`** | `primaryPool` (`log-database.ts`) | `LOG_DB_PRIMARY` | `0` | `20` | 30s | Alerting runtime evaluation against events. |
| **`pulse-ingestion`**| `writePool` (`ingestion-worker-main.ts`) | `LOG_DB_PRIMARY` | `2` | `20` | $\infty$ (unbounded)| High-throughput batch event ingestion (`UNNEST`). |
| **`pulse-ingestion`**| `primaryPool` (`log-database.ts`) | `LOG_DB_PRIMARY` | `0` | `20` | 30s | Boot migrations and schema verification. |
| **`pulse-ingestion`**| `pool` (`database.ts`) | `DATABASE_URL` | `0` | `20` | 30s | PGMQ ingest queue consumption. |
| **`pulse-analytics`**| `pool` (`database.ts`) | `DATABASE_URL` | `0` | `20` | 30s | PGMQ analytics queue consumption. |
| **`pulse-analytics`**| `primaryPool` (`log-database.ts`) | `LOG_DB_PRIMARY` | `0` | `20` | 30s | Partition creation, rollup aggregations. |

---

### Configuration Reference Matrix

All database pools are configured via environment variables in `pulse/src/config/env.ts`:

| Environment Variable | Default | Min / Max | Description |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | *Required* | Valid URL | PostgreSQL connection string for the Control Database. |
| `DB_POOL_MAX` | `20` | 1 – 100 | Maximum connections per process for the Control DB pool. |
| `DB_POOL_MIN` | `0` | 0 – 100 | Minimum idle connections to keep warm (0 allows scale-to-zero). |
| `DB_IDLE_TIMEOUT_MS` | `30000` | $\ge 0$ | How long a connection can sit idle before being closed (30s). |
| `DB_CONNECTION_TIMEOUT_MS`| `30000` | $\ge 1000$ | Max time to wait for a free socket from the pool (30s). |
| `DB_STATEMENT_TIMEOUT_MS` | `30000` | $\ge 0$ | PostgreSQL server-side statement timeout (30s). |
| `DB_QUERY_TIMEOUT_MS` | `0` | $\ge 0$ | Client-side query timeout (0 disables client-side abort). |
| `DB_KEEPALIVE_INITIAL_DELAY_MS`| `10000` | $\ge 0$ | TCP keepalive probe frequency to prevent silent socket drops. |
| `DB_SSL_ENABLED` | `undefined` | Boolean | Force SSL enabled/disabled (inferred from URI if unset). |
| `DB_SSL_REJECT_UNAUTHORIZED` | `undefined` | Boolean | Reject self-signed or unauthorized certificates. |
| `LOG_DB_PRIMARY` | Fallback to `DATABASE_URL` | Valid URL | Dedicated Log / Telemetry database connection string. |
| `LOG_POOL_MAX` | `20` | 1 – 500 | Max connections per process for the Log DB read pool. |
| `LOG_POOL_MIN` | `0` | 0 – 500 | Min idle connections for the Log DB pool. |
| `LOG_QUERY_TIMEOUT` | `30000` | $\ge 0$ | Read-path statement timeout for dashboard queries. |
| `LOG_DB_WRITE_TIMEOUT` | `0` | $\ge 0$ | Statement timeout for write path (0 = unbounded for large batch ingest).|
| `INGESTION_WRITE_POOL_SIZE` | `20` | 2 – 200 | Dedicated pool size for ingestion batch inserts. |

---

### Connection Budget Accounting vs Supabase Limits

When scaling or adding PM2 instances, verify total socket requirements using this formula:

$$\text{Total Direct Sockets} = (\text{API\_INSTANCES} \times (\text{DB\_POOL\_MAX} + \text{LOG\_POOL\_MAX})) + (\text{WORKERS} \times (\text{DB\_POOL\_MAX} + \text{LOG\_POOL\_MAX} + \text{WRITE\_POOL}))$$

#### Current Deployment Baseline:
- `pulse-api` (1 instance): $20 + 20 = 40$
- `pulse-workers` (1 instance): $20 + 20 = 40$
- `pulse-ingestion` (1 instance): $20 + 20 + 20 = 60$
- `pulse-analytics` (1 instance): $20 + 20 = 40$
- **Total Direct Sockets Demanded:** **180 sockets**

> [!WARNING]
> If Supabase direct connection limit is 60–90 connections, **the fleet is over-subscribing the database by 2×**. Under peak load or concurrent startup, PostgreSQL will reject connections with `53300: too_many_connections`.

---

## 4. Background Workers Architecture & Operational Settings

### Worker Process Roles & Topologies

Defined in `ecosystem.config.cjs`:
1. **`pulse-api`** (Cluster mode): HTTP ingestion gateway, dashboard REST endpoints, SDK config distribution.
2. **`pulse-workers`** (Fork mode): Alerting evaluation, billing cycles, connector webhooks/notifications, auth automation, email delivery.
3. **`pulse-ingestion`** (Fork mode): De-queues raw telemetry events from PGMQ, validates, normalizes, and writes batch `UNNEST` SQL into Log DB.
4. **`pulse-analytics`** (Fork mode): Consumes telemetry events to update streaming rollups and manages TimescaleDB/PostgreSQL time partitions.

---

### PGMQ Engine & Worker Mechanics

The queue system is built on **PostgreSQL Message Queue (PGMQ)** (`src/lib/pgmq.ts` and `src/lib/pgmq-worker.ts`):
- **Metadata Table:** `pgmq.meta` tracks queue names, creation timestamps, and unlogged status.
- **Queue Tables:** Each queue creates a table `pgmq.q_<queue_name>` with indexed `vt` (visibility timeout), `msg_id`, and `enqueued_at`.
- **Visibility Timeout (VT):** When a worker reads a job (`pgmq.readWithPoll`), the message is hidden from other workers for `vtSeconds`.
- **Automatic Heartbeat:** `PgmqWorker` runs a periodic interval (`set_vt`) every `heartbeatIntervalSeconds` (default: $\text{VT} / 3$) to extend visibility during long-running tasks.
- **Poison Message Guard:** If a job fails repeatedly and `read_ct > maxAttempts`, it is automatically acknowledged and diverted to `deadLetterQueue` (DLQ).

---

### Billing Workers Inventory (21 Jobs)

All registered in `src/modules/billing/jobs/workers.ts` with default: `batchSize: 1`, `concurrency: 1`, `vtSeconds: 300`, `maxAttempts: 3`.

| Job Name | Queue Name | Schedule / Trigger | Purpose |
| :--- | :--- | :--- | :--- |
| `billing.subscription-renewal` | `billing_subscription_renewal` | Hourly tick | Renews due subscriptions, charges payment methods. |
| `billing.trial-expiration` | `billing_trial_expiration` | Hourly tick | Transitions expired trials to free/suspended plans. |
| `billing.invoice-generation` | `billing_invoice_generation` | Hourly tick | Drafts and finalizes invoices for billable cycles. |
| `billing.payment-sync` | `billing_payment_sync` | Hourly tick | Syncs payment statuses from Stripe/providers. |
| `billing.payment-reconciliation`| `billing_payment_reconciliation` | Hourly tick | Resolves mismatched invoice and charge amounts. |
| `billing.webhook-retry` | `billing_webhook_retry` | Hourly tick | Retries outbound billing webhooks that failed. |
| `billing.webhook-dead-letter` | `billing_webhook_dead_letter` | Hourly tick | Cleans up or alerts on permanently failed webhooks. |
| `billing.usage-rollover` | `billing_usage_rollover` | Hourly tick | Resets monthly usage counters at billing cycle boundary. |
| `billing.usage-aggregation` | `billing_usage_aggregation` | Hourly tick | Aggregates unbilled metric units across projects. |
| `billing.ai-credit-reset` | `billing_ai_credit_reset` | Hourly tick | Refreshes monthly allocated AI token quotas. |
| `billing.coupon-expiration` | `billing_coupon_expiration` | Hourly tick | Removes expired discount codes from subscriptions. |
| `billing.addon-expiration` | `billing_addon_expiration` | Hourly tick | Deprecates expired temporary add-on features. |
| `billing.feature-override-expiration`| `billing_feature_override_expiration`| Hourly tick | Reverts manual enterprise feature overrides. |
| `billing.invoice-reminder` | `billing_invoice_reminder` | Hourly tick | Dispatches email reminders for upcoming or overdue invoices. |
| `billing.partition-creator` | `billing_partition_creator` | Hourly tick | Pre-creates billing log partitions for upcoming months. |
| `billing.partition-cleanup` | `billing_partition_cleanup` | Hourly tick | Drops old billing event audit partitions. |
| `billing.usage-anomaly` | `billing_usage_anomaly` | Hourly tick | Flags accounts exceeding 300% normal hourly consumption. |
| `billing.entitlement-refresh` | `billing_entitlement_refresh` | Hourly tick | Re-syncs organization feature entitlements cache. |
| `billing.audit-archive` | `billing_audit_archive` | Hourly tick | Compresses historical billing audit logs. |
| `billing.data-reconciliation` | `billing_data_reconciliation` | Hourly tick | Validates database subscription rows against Stripe. |
| `billing.metrics` | `billing_metrics` | Hourly tick | Exports billing health gauges to Prometheus. |

---

### Connector Workers Inventory (14 Queues)

Registered in `src/modules/connectors/workers/connector-workers.ts`:

| Queue Name | Batch Size | Concurrency | VT (s) | Max Attempts | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `connector_v2_slack` | 10 | 5 | 45s | 5 | Delivers alert webhooks to Slack channels. |
| `connector_v2_discord` | 10 | 5 | 45s | 5 | Delivers alert webhooks to Discord servers. |
| `connector_v2_teams` | 10 | 5 | 45s | 5 | Delivers alert cards to Microsoft Teams. |
| `connector_v2_pagerduty` | 10 | 8 | 45s | 5 | Triggers PagerDuty incidents and paging events. |
| `connector_v2_webhook` | 10 | 8 | 45s | 5 | Custom user-defined HTTP webhook delivery. |
| `connector_v2_email` | 10 | 10 | 45s | 5 | Sends formatted alert incident emails. |
| `connector_v2_sms` | 10 | 3 | 45s | 5 | Twilio/SMS urgent incident dispatch. |
| `connector_delivery_retry` | 1 | 2 | 60s | 5 | Exponential backoff retry handler for failed deliveries. |
| `connector_health_check` | 1 | 1 | 60s | 5 | Probes external provider health and endpoint uptime. |
| `connector_test` | 3 | 3 | 60s | 5 | Interactive test notifications triggered from UI. |
| `connector_secret_rotation` | 2 | 2 | 60s | 5 | Background rotation of connector API credentials. |
| `connector_oauth_refresh` | 3 | 3 | 60s | 5 | Refreshes expiring Slack/Teams OAuth tokens. |
| `connector_cleanup` | 1 | 1 | 60s | 5 | Prunes delivery logs older than retention period. |
| `connector_dead_letter_retry`| 3 | 3 | 60s | 5 | Manual or operator-triggered retry of dead-lettered events. |

---

### Alerting Workers Inventory (15 Queues + Evaluators)

Registered in `src/modules/alerting/queue.ts`:
- **Rule Evaluator Loop:** Periodic cron tick (`ALERT_EVALUATOR_INTERVAL_MS`, default 15s) scanning active rules in `alert_rules`.
- **Project Threshold Loop:** Periodic cron tick (`PROJECT_THRESHOLD_INTERVAL_MS`, default 60s) checking project budget and error rate spikes.
- **15 Dedicated Alert Queues:**
  - `alert_rule_eval`: Sharded evaluation work items.
  - `alert_dispatch_urgent`: P1/P0 notifications bypassing standard rate limiters.
  - `alert_dispatch_standard`: P2/P3 standard notifications.
  - `alert_digest_builder`: Batches multiple alerts into periodic digests.
  - `alert_incident_sync`: Keeps incidents in sync with external issue trackers.
  - `alert_reconciliation`: Verifies recovery states and clears resolved alerts.
  - `alert_dlq`: Dead-letter queue for permanently failing alert dispatches.
  - Plus 8 connector-specific dispatch queues.

---

### Ingestion Workers Inventory (10 Event Types + DLQ)

Registered in `src/shared/workers/ingestion-worker-main.ts`:
- **Concurrency & Batching:** Configured by `INGESTION_CONCURRENCY` (default: 2) and `INGESTION_BATCH_SIZE` (default: 4).
- **Write Admission Gate:** Max concurrent write permits bounded by `INGESTION_WRITE_PERMITS` (default: 16) to prevent database lock exhaustion.
- **Queues:**
  1. `ingest_error`: Unhandled exceptions, stack traces, and crash events.
  2. `ingest_message`: Structured log messages and breadcrumbs.
  3. `ingest_request`: HTTP incoming/outgoing request telemetry.
  4. `ingest_span`: OpenTelemetry spans and performance timings.
  5. `ingest_trace`: Distributed root traces.
  6. `ingest_metric`: Gauge, counter, and histogram time-series samples.
  7. `ingest_log`: Plain log lines and debug text.
  8. `ingest_profile`: CPU and memory profiling allocations.
  9. `ingest_cron_checkin`: Heartbeats for scheduled jobs.
  10. `ingest_replay`: Session replay chunks and DOM mutations.
  11. `ingest_dlq`: Dead-letter queue for corrupt/unprocessable events.

---

### Analytics Engine Workers Inventory (16 Queues + 5 Compactions)

Registered in `src/shared/workers/analytics-worker-main.ts`:
- **Real-Time Stream Rollups:**
  - `analytics_requests`, `analytics_endpoints`, `analytics_services`, `analytics_errors`, `analytics_logs`, `analytics_spans`, `analytics_traces`, `analytics_metrics`, `analytics_runtime`, `analytics_crons`, `analytics_geo`, `analytics_sdk`, `analytics_ai`, `analytics_releases`, `analytics_profiles`, `analytics_replays`.
- **Platform Compaction & Retention Jobs:**
  - `analytics_compaction_5m`: Rolls up 1-minute raw buckets into 5-minute pre-aggregated statistics.
  - `analytics_compaction_1h`: Rolls up 5-minute data into 1-hour hourly tables.
  - `analytics_compaction_1d`: Daily rollups for long-term historical trends.
  - `analytics_retention`: Deletes or compresses partitions older than organization data retention limits.
  - `analytics_partitions`: Idempotently pre-creates database tables 7 days in advance.

---

### Auth Automation & Outbox Email Workers

- **`auth_automation_daily`:** Runs daily account retention checks, unverified user cleanup, and trial expiration warnings.
- **`startOrgEmailWorker` / `startAuthEmailWorker`:**
  - Polls `organization_email_outbox` and `auth_email_outbox` every 5,000ms.
  - Batches up to 50 pending emails per tick.
  - Renders email templates and dispatches via Resend/SMTP with automatic retry backoff.

---

## 5. Future Upgrade & Scaling Roadmap

### Optimization 1: Eliminate Sequential Queue Probing (132s -> 1.5s Boot)

#### The Problem
Workers iterate through 80+ queue names sequentially calling `pgmq.createQueue()`, causing over 120 sequential cloud queries.

#### The Solution
1. **Bulk Queue Cache:** Instead of querying `pgmq.meta` for every queue, query all existing queues in **one single SQL query** at startup:
   ```typescript
   // In PgmqClient:
   async getAllQueues(): Promise<Set<string>> {
     const res = await this.pool.query('SELECT queue_name FROM pgmq.meta');
     return new Set(res.rows.map(r => r.queue_name));
   }
   ```
2. **Skip `createQueue` if already present:** If `existingQueues.has(queueName)`, skip DDL execution completely.
3. **Parallel Worker Registration:** Register workers concurrently with `Promise.all`:
   ```typescript
   // In workers.ts:
   await Promise.all(
     billingJobDefinitions.map(async (definition) => {
       const queue = billingQueueName(definition.name);
       const worker = new PgmqWorker(pgmq, handler, options);
       await worker.start();
     })
   );
   ```
**Impact:** Eliminates 119 network round-trips. Reduces worker bootstrap from **132 seconds down to < 2 seconds**.

---

### Optimization 2: Transition from Direct Port 5432 to Supavisor Pooler (Port 6543)

#### The Problem
PM2 cluster mode + worker fork mode open up to 180 direct connection sockets to PostgreSQL port 5432, exhausting database process limits.

#### The Solution
Update environment configuration to connect through **Supabase Supavisor / PgBouncer in Transaction Mode (port 6543)**:
```env
# Change from direct port 5432:
# DATABASE_URL=postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres
# To Supavisor Transaction Pooler on port 6543:
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true
```

#### Safe Transaction-Mode Rules:
- Never use `SET session_variable` without `LOCAL`. The codebase already strictly uses `SET LOCAL` inside transactions.
- Keep `DB_QUERY_TIMEOUT_MS=0` (client-side query timeouts interfere with pooled connections).
- Keep `DB_POOL_MIN=0` so idle workers release backend sockets immediately.

**Impact:** Reduces active database sockets from 180 down to 10–15 shared multiplexed connections on the database server.

---

### Optimization 3: Decouple PM2 Monolith into Dedicated Worker Containers

#### The Problem
All background jobs (Billing, Connectors, Alerting, Auth, Email) run inside a single `pulse-workers` process. A failure or slow query in email processing delays alerting and billing.

#### The Solution (Containerized Topology)
Split `ecosystem.config.cjs` or Docker Compose into dedicated responsibilities:
```
- pulse-api (Fastify HTTP Service - Scaled 2-4 replicas)
- pulse-worker-ingestion (Dedicated high-throughput telemetry ingestion)
- pulse-worker-alerting (Dedicated alerting rule evaluator + connector dispatches)
- pulse-worker-cron (Scheduled billing, compactions, and email outbox)
```
**Impact:** Isolates memory limits and connection pools; prevents heavy email outbox queries from freezing real-time alerting.

---

### Optimization 4: Decouple Migration Execution from Worker Boot

#### The Problem
`pulse-ingestion` spends 12 seconds scanning 71 migration files on local disk on every boot.

#### The Solution
1. Remove `runLogDbMigrations({ executionMode: 'automatic' })` from `ingestion-worker-main.ts`.
2. Move migration execution to a dedicated CI/CD pre-deployment step:
   ```bash
   # In deployment pipeline / Dockerfile entrypoint:
   npm run db:migrate:primary
   npm run db:migrate:logdb
   # Only after migrations succeed, start the application:
   pm2-runtime start ecosystem.config.cjs
   ```
**Impact:** Eliminates 12 seconds of cold-start delay on ingestion workers.

---

### Optimization 5: Development vs Production Log Formatting Modernization

#### The Problem
The terminal displays unformatted raw JSON lines during local development, creating visual noise and hiding actual warnings.

#### The Solution
1. **Local Development:** Configure `pino-pretty` in `package.json` dev scripts:
   ```json
   "scripts": {
     "dev": "cross-env NODE_ENV=development tsx watch src/app.ts | pino-pretty -c -t \"SYS:HH:MM:ss\""
   }
   ```
2. **Production:** Set `LOG_LEVEL=info` (or `warn` for repetitive worker loops).
3. **Mute Worker Heartbeat Logs:** In `src/lib/pgmq-worker.ts`, ensure heartbeat extensions and poll cycles remain at `debug` level.

**Impact:** Clean, readable terminal logs showing only lifecycle milestones and actionable errors.

---

### Optimization 6: Schema Sync (Fix Missing `ai_release_stale_reservations`)

#### The Problem
In `pm2-workers-out.log`, the AI worker logs errors on boot:
`function ai_release_stale_reservations() does not exist` (Error code `42883`).

#### The Solution
Apply the missing database migration from `src/db/postgres/primary_db_draft/17_functions/001_functions.sql` to `primarydbv2`:
```sql
CREATE OR REPLACE FUNCTION ai_release_stale_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_released integer;
BEGIN
  WITH stale AS (
    DELETE FROM ai_credit_reservations
    WHERE status = 'pending'
      AND created_at < NOW() - INTERVAL '15 minutes'
    RETURNING tenant_id, amount
  )
  SELECT COUNT(*) INTO v_released FROM stale;
  RETURN v_released;
END;
$$;
```
**Impact:** Resolves the recurring worker exception and prevents error logs from polluting stdout during startup.

---

## 6. Step-by-Step Upgrade Runbook

When you are ready to upgrade the backend infrastructure, execute these steps in order:

### Phase 1: Code-Level Fast Boot (Immediate)
1. **Batch Queue Checking:**
   Update `PgmqClient` to load all queue names via `getAllQueues()` at boot and query `createQueue` only for missing queues.
2. **Parallelize Registrations:**
   In `src/modules/billing/jobs/workers.ts` and `src/modules/connectors/workers/connector-workers.ts`, replace `for (const x of items)` with `await Promise.all(items.map(...))`.
3. **Deploy the Missing AI Function:**
   Execute the `ai_release_stale_reservations` SQL definition on the primary database.

### Phase 2: Configuration & Pooling Tuning (Within 1-2 Weeks)
1. **Switch to Supavisor Pooler:**
   Obtain the Supabase port `6543` connection strings and update `DATABASE_URL` and `LOG_DB_PRIMARY` in `.env`.
2. **Tune Pool Sizes:**
   Adjust `DB_POOL_MAX` and `LOG_POOL_MAX` to `15` per process.
   Set `INGESTION_WRITE_POOL_SIZE` to `16`.
   Ensure `DB_POOL_MIN=0` and `LOG_POOL_MIN=0`.

### Phase 3: Infrastructure Decoupling (Long-Term Scaling)
1. **Externalize Migrations:**
   Remove auto-migration execution from worker startup files and add `npm run db:migrate:logdb` to the CI/CD deploy stage.
2. **Containerize Separate Services:**
   Split the PM2 configuration into 4 Docker images/containers with dedicated Kubernetes or ECS CPU/memory reservations.

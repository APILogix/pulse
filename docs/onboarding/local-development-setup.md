# Local Development Setup & Developer Onboarding

## 1. System Role & Responsibilities

This runbook establishes a reproducible, production-parity local development environment for Senior Backend Engineers joining the Pulse platform team. It covers environment provisioning, dual-database setup, modular schema migrations, seed data population, local worker clustering, test harness execution, and memory diagnostics.

### What This Guide Provides
- **Prerequisites & Toolchain Specifications**: Exact runtime, engine, and database extension versions required to build and execute the backend.
- **Environment Bootstrap Workflow**: Step-by-step configuration of `.env` files with cryptographically distinct secret generation.
- **Dual-Datastore Modular Migration**: Execution of topological SQL migrations via `scripts/run-modular-schema.ts` against Primary DB (control plane / PGMQ) and Log DB (TimescaleDB).
- **Seed Data Population**: Initialization of billing tiers, test organizations, projects, admin users, and scoped API keys.
- **Process Orchestration**: Instructions for running single-process development, standalone worker pipelines, and multi-process PM2 production clusters.
- **Verification & Soak Testing**: Running unit test suites, static query linting gates, and 50k-event memory leak soak harnesses.

---

## 2. Code Traceability Map

| Task / Lifecycle Step | Key File Path | Command / Script | Primary Responsibility |
| :--- | :--- | :--- | :--- |
| **Modular Schema Runner** | [`scripts/run-modular-schema.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/scripts/run-modular-schema.ts) | `npm run db:schema:run` | Topologically discovers and executes 41 modular SQL definitions across `primarydbv2` and `logdbv2`. |
| **Fresh Database Recreate** | [`scripts/run-modular-schema.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/scripts/run-modular-schema.ts) | `npm run db:schema:run:recreate` | Drops and rebuilds all tables, functions, and views in local development databases. |
| **Primary Data Seeder** | [`scripts/run-primary-seeders.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/scripts/run-primary-seeders.ts) | `npm run db:seed` | Populates default admin account, test organizations, projects, environments, and API keys. |
| **Billing Plan Seeder** | [`scripts/seed-billing-plans.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/scripts/seed-billing-plans.ts) | `npm run db:seed:billing` | Inserts subscription plan tiers (`free`, `starter`, `pro`, `enterprise`) into `billing_plans`. |
| **API Server Entry Point** | [`src/main.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/main.ts) | `npm run dev` | Boots Fastify HTTP server with live file watching via `tsx watch`. |
| **Ingestion Worker Entry** | [`src/shared/workers/ingestion-worker-main.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/shared/workers/ingestion-worker-main.ts) | `npm run dev:ingestion` | Boots standalone PGMQ consumer pipeline for 15 SDK event types. |
| **Analytics Worker Entry** | [`src/shared/workers/analytics-worker-main.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/shared/workers/analytics-worker-main.ts) | `npm run dev:analytics` | Boots continuous 1-minute and 1-hour rollup aggregation and retention workers. |
| **Alert Worker Entry** | [`src/shared/workers/alert-workers-main.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/shared/workers/alert-workers-main.ts) | `npm run dev:alert:workers` | Boots alert decision engines, escalation sweeps, and notification routers. |
| **PM2 Cluster Definition** | [`ecosystem.config.cjs`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/ecosystem.config.cjs) | `npm run pm2:start` | Orchestrates 4 isolated Node.js processes with dedicated memory limits and auto-restart policies. |
| **Static Query Linter Gate** | [`scripts/audit-primarydb-queries.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/scripts/audit-primarydb-queries.ts) | `npm run lint:queries` | AST analysis verifying SQL statements for index utilization and partition pruning. |
| **Memory Soak Test** | [`scripts/stress-test-memory.ts`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/scripts/stress-test-memory.ts) | `npm run stress:memory` | Simulates 50,000 sustained ingestion payloads with explicit post-GC memory delta assertions. |

---

## 3. Architecture & Bootstrap Flow Diagram

The following diagram illustrates the local developer bootstrap lifecycle:

```mermaid
sequenceDiagram
    autonumber
    participant Dev as Senior Engineer
    participant Git as Git Repo
    participant Postgres as Local / Remote PostgreSQL
    participant SchemaRunner as run-modular-schema.ts
    participant Seeder as run-primary-seeders.ts
    participant DevServer as tsx watch src/main.ts

    Dev->>Git: git clone & npm install
    Dev->>Dev: cp .env.example .env (generate 5 distinct secrets)
    
    Dev->>Postgres: Verify PostgreSQL running with TimescaleDB & PGMQ extensions
    Dev->>SchemaRunner: npm run db:schema:run
    SchemaRunner->>Postgres: Execute database/primarydbv2/schema/*.sql (Topological order)
    SchemaRunner->>Postgres: Execute database/logdbv2/schema/*.sql (Topological order)
    SchemaRunner-->>Dev: Schema migration successfully applied
    
    Dev->>Seeder: npm run db:seed
    Seeder->>Postgres: Insert admin user, org, project, and pv_live_ API key
    Dev->>Seeder: npm run db:seed:billing
    Seeder->>Postgres: Insert billing plan tiers (free, starter, pro, enterprise)
    
    Dev->>DevServer: npm run dev
    DevServer->>Postgres: Validate connection pools & boot Fastify on :3000
    DevServer-->>Dev: Ready on http://localhost:3000 (Health: /ready)
```

---

## 4. Prerequisites & Environment Setup

### 4.1 System Prerequisites
- **Node.js**: `v20.x` or `v22.x` LTS. Verify via `node -v`.
- **Package Manager**: `npm` v10+ (ships with Node).
- **PostgreSQL**: Version 15+ or 16+.
  - Required Extensions: `pgmq`, `timescaledb` (for Log DB), `uuid-ossp`, `pgcrypto`.
- **Redis** *(Optional for local dev)*: Redis v7.0+. If unconfigured, set `REDIS_REQUIRED=false`.

### 4.2 Local Environment Configuration
Create a `.env` file in the repository root:

```bash
cp .env.example .env
```

Generate five distinct 32-character hexadecimal secrets using Node.js crypto:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Populate the minimal working configuration:

```ini
# ── Server Runtime ──────────────────────────────────────────────────────────
NODE_ENV=development
PORT=3000
HOST=0.0.0.0
ALLOWED_ORIGINS=http://localhost:5173

# ── Primary Database (Control Plane + PGMQ) ─────────────────────────────────
DATABASE_URL=postgres://postgres:postgres@localhost:5432/pulse_primary
DB_SSL_ENABLED=false
DB_SSL_REJECT_UNAUTHORIZED=false
DB_FAMILY=0
DB_POOL_MAX=20

# ── Log Database (TimescaleDB Telemetry) ─────────────────────────────────────
# For local dev, can point to the same database as DATABASE_URL or dedicated DB
LOG_DB_PRIMARY=postgres://postgres:postgres@localhost:5432/pulse_logdb
LOG_DB_ENABLE_TIMESCALE=true
LOG_DB_SSL_ENABLED=false
LOG_DB_SSL_REJECT_UNAUTHORIZED=false
LOG_POOL_MAX=20

# ── Cryptographic Secrets (MUST all be distinct) ─────────────────────────────
JWT_SECRET=8f4a3e2b1c0d9e8f7a6b5c4d3e2f1a0b8f4a3e2b1c0d9e8f7a6b5c4d3e2f1a0b
JWT_REFRESH_SECRET=1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d
COOKIE_SECRET=9e8f7a6b5c4d3e2f1a0b8f4a3e2b1c0d9e8f7a6b5c4d3e2f1a0b8f4a3e2b1c0d
AUTH_TOKEN_SECRET=3c4d5e6f7a8b9c0d1e2f3a4b5c6d1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d1a2b
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef  # Exactly 32 characters

# ── Queue & Workers ─────────────────────────────────────────────────────────
QUEUE_BATCH_SIZE=50
QUEUE_VISIBILITY_TIMEOUT_SECONDS=60
QUEUE_POLL_SECONDS=2
QUEUE_POOL_MAX=10
QUEUE_COMMAND_POOL_MAX=15

# ── Redis (Optional in local dev) ───────────────────────────────────────────
REDIS_URL=redis://localhost:6379
REDIS_REQUIRED=false
```

---

## 5. Step-by-Step Developer Runbook

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Provision Databases & Run Modular Schemas
Execute the topological schema runner:

```bash
# Run schema migration across both Primary DB and Log DB
npm run db:schema:run

# Alternatively, for a clean wipe and rebuild:
npm run db:schema:run:recreate
```

### Step 3: Populate Seed Data
Populate default organization, admin user, and billing tiers:

```bash
# Seeds admin account, test project, and pv_live_ API key
npm run db:seed

# Seeds billing subscription plans
npm run db:seed:billing
```

### Step 4: Run the Application

#### Option A: Unified Development Mode (Fastest)
Runs the API server with live TypeScript reload:
```bash
npm run dev
```

In separate terminal windows, start the background workers as needed:
```bash
# Ingestion Worker (processes incoming SDK telemetry)
npm run dev:ingestion

# Analytics Worker (computes 1m and 1h rollups)
npm run dev:analytics

# Alerting Worker (rule evaluation and notifications)
npm run dev:alert:workers
```

#### Option B: PM2 Production-Parity Cluster
Simulates the 4-process production architecture locally:
```bash
# Build TypeScript
npm run build

# Start PM2 cluster
npm run pm2:start

# Monitor status and real-time logs
npm run pm2:status
npm run pm2:logs
npm run pm2:monit
```

---

## 6. Testing, Linting & Memory Soak Verification

### 6.1 Unit & Integration Test Suites
Run Vitest across the codebase:
```bash
# Run all unit tests
npm test

# Run queue worker reliability suite specifically
npx vitest run test/unit/pgmq-worker-reliability.test.ts
```

### 6.2 Static Query Linter Gate
Audit all PostgreSQL queries in the codebase to guarantee that no un-indexed sequential table scans or partition pruning violations exist:
```bash
npm run lint:queries
```

### 6.3 50k-Event Memory Soak Test Harness
Run the memory soak harness to confirm zero event loop blocking and verify memory stability:
```bash
npm run stress:memory
```
This harness pushes 50,000 synthetic telemetry events through the admission gate, triggers explicit garbage collection sweeps (`--expose-gc`), and validates that `postGcMemory` remains within the allowed baseline threshold.

### 6.4 Ingestion Benchmark Matrix
Measure end-to-end ingestion throughput and queue latency under sustained concurrency:
```bash
npm run bench:ingestion:matrix
```

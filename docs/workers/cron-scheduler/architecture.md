# Cron Scheduler Process Architecture

The **Cron Scheduler Process** (`dist/shared/workers/cron.js`) is the dedicated periodic schedule dispatcher that triggers recurring background jobs, subscription reconciliations, telemetry maintenance sweeps, and cleanup crons into pg-boss.

```mermaid
flowchart TD
    subgraph CronProcess ["Cron Scheduler Process (PM2 Fork)"]
        CronEngine["pg-boss Schedule Dispatcher"]
        SchedLedger["Schedule Ledger & Cron Definitions"]
    end

    subgraph PGBossQueues ["pg-boss Queues"]
        QOrgClean["org-cleanup-cron (Daily @ 02:00 UTC)"]
        QAuthClean["auth-cleanup-cron (Hourly)"]
        QBillSync["billing-usage-sync (Every 6 Hours)"]
        QMaint["telemetry-maintenance-cron (Daily @ 04:00 UTC)"]
        QConnMon["connector-health-check (Every 15 Mins)"]
    end

    CronEngine --> SchedLedger
    CronEngine -->|"pg-boss.schedule()"| QOrgClean
    CronEngine -->|"pg-boss.schedule()"| QAuthClean
    CronEngine -->|"pg-boss.schedule()"| QBillSync
    CronEngine -->|"pg-boss.schedule()"| QMaint
    CronEngine -->|"pg-boss.schedule()"| QConnMon
```

---

## 1. Core Architectural Responsibilities

1. **Centralized Job Scheduling**: Single source of truth for all periodic cron expressions (`cron.ts`).
2. **Distributed Leader Safety**: pg-boss manages internal distributed lock records so multiple running scheduler replicas do not dispatch duplicate jobs.
3. **Zero Business Logic in Scheduler**: The scheduler solely enqueues job payloads; actual computation occurs in worker tiers (`main.ts`, `ingestion-worker-main.ts`).

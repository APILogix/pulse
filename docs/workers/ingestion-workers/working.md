# Ingestion Worker Tier Working & Operational Guide

This document describes batch consumer execution, bulk write queries, failure retries, and dead-letter queue (DLQ) mechanics for the **Ingestion Worker Tier**.

---

## 1. Batch Persistence Execution Flow

```mermaid
sequenceDiagram
    autonumber
    participant Boss as pg-boss (Queue: ingest-trace)
    participant Worker as EventProcessor Worker
    participant DB as Log DB Telemetry Writer
    participant Usage as Usage Rollup Service
    participant DLQ as Dead-Letter Queue

    Boss->>Worker: Dispatch Job Batch (e.g. 50 jobs with 10 events each)
    Worker->>Worker: Unpack and Group Events by Target Partition Table
    Worker->>DB: Execute Bulk INSERT via UNNEST() Arrays
    alt Bulk Insert Succeeds
        Worker->>Usage: Record Batch Count in Memory Buffer
        Worker->>Boss: Acknowledge Jobs (Complete)
    else DB Error / Transient Lock Failure
        Worker->>Boss: Fail Jobs (Triggers Exponential Retry)
    else Unrecoverable Schema Error (Max Retries Exceeded)
        Worker->>DLQ: Route to dead_letter_jobs Table
        Worker->>Boss: Complete Job to Prevent Poison Loop
    end
```

---

## 2. Process Commands & Management

```bash
# Run Ingestion Worker locally
npm run dev:ingestion

# Run Ingestion Worker in production
npm run start:ingestion

# PM2 cluster management
npx pm2 start ecosystem.config.cjs --only ingestion-workers
```

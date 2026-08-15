# Background Worker Tier Working & Operational Guide

This document describes the operational procedures, job processors, and shutdown lifecycles for the **Background Worker Tier**.

---

## 1. Process Lifecycle & Graceful Drain

```mermaid
sequenceDiagram
    autonumber
    actor Ops as PM2 / Kubernetes Supervisor
    participant Worker as Background Worker Process (main.ts)
    participant Boss as pg-boss Instance
    participant Maint as Telemetry Maintenance
    participant DB as Postgres Pools

    Ops->>Worker: SIGTERM Signal
    Worker->>Worker: Mark shuttingDown = true
    Worker->>Maint: Stop maintenance timer
    Worker->>Boss: Stop accepting new jobs & wait for in-flight tasks (drain)
    Boss-->>Worker: All active handlers finished
    Worker->>DB: Close Primary & Log DB Connection Pools
    Worker->>Ops: Process Exit (Code 0)
```

---

## 2. Process Commands & Management

```bash
# Run background workers locally
npm run dev:workers

# Run in production
npm run start:workers

# Start via PM2
npx pm2 start ecosystem.config.cjs --only background-workers
```

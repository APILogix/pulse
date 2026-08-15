# Alerting Module Working & Operational Guide

This document describes alert condition rules, state transition mechanics, and API endpoints for the **Alerting Module**.

---

## 1. Alert Rule Evaluation Cycle

```mermaid
sequenceDiagram
    autonumber
    participant Sched as Alert Evaluator Cron (1m)
    participant Eval as Evaluator Engine
    participant LogDB as Log DB (Telemetry)
    participant State as Alert State DB
    participant Dispatch as Connector Dispatcher

    Sched->>Eval: Evaluate Active Rules for Project
    Eval->>LogDB: SELECT COUNT(*) / AVG() over evaluation window (e.g. 5m)
    LogDB-->>Eval: Current Calculated Value (e.g. errorRate = 5.2%)
    alt Value > Threshold (Threshold = 2.0%)
        Eval->>State: Check Previous State
        alt Was OK
            State->>State: Transition to PENDING (Record started_at)
        else Was PENDING and Duration >= forDuration (e.g. 3m)
            State->>State: Transition to FIRING & Record Alert Incident
            Eval->>Dispatch: Dispatch Notification to Routing Channels
        end
    else Value <= Threshold
        alt Was FIRING
            State->>State: Transition to RESOLVED
            Eval->>Dispatch: Dispatch Auto-Resolution Notification
        else Was PENDING
            State->>State: Reset to OK
        end
    end
```

---

## 2. API Endpoints

- **`GET /api/v1/alerts/rules`**: Lists configured alert rules.
- **`POST /api/v1/alerts/rules`**: Creates a new alert rule (Metric, Error Count, Latency p95, Anomaly).
- **`GET /api/v1/alerts/history`**: Lists past alert incidents, firings, and resolution timestamps.
- **`POST /api/v1/alerts/silences`**: Configures temporary maintenance silence periods.

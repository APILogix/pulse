# Observability Module Working & Operational Guide

This document describes the APIs, waterfall assembly mechanics, and release tracking workflows of the **Observability Module**.

---

## 1. Trace & Waterfall Assembly Workflow

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer / SRE
    participant API as Observability API
    participant Svc as Observability Service
    participant Repo as Observability Repository
    participant LogDB as Log DB (Partitioned Spans)

    Dev->>API: GET /api/v1/observability/traces/:traceId (with projectId)
    API->>Svc: getTraceDetails(traceId, projectId)
    Svc->>Repo: fetchAllSpansForTrace(traceId)
    Repo->>LogDB: SELECT * FROM spans_* WHERE trace_id = $1
    LogDB-->>Repo: Return raw span records
    Svc->>Svc: Build Tree Hierarchy (Parent-Child Span ID Matching)
    Svc->>Svc: Compute Duration, Self-Time & Relative Offsets
    Svc-->>API: Return Structured Waterfall Tree
    API-->>Dev: 200 OK (Full Waterfall JSON)
```

---

## 2. API Endpoints

- **`GET /api/v1/observability/traces/:traceId`**: Fetches root span, child span tree, total duration, database query breakdowns, and correlated log events.
- **`GET /api/v1/observability/service-map`**: Computes interactive service dependency graph with edge request rates, p95 latency, and error counts.
- **`GET /api/v1/observability/releases`**: Returns project releases, adoption percentages, and regression alerts.
- **`GET /api/v1/observability/resources/:id`**: Universal polymorphic resource finder resolving any public ID into its concrete entity.

# Event Analytics Module Working & Operational Guide

This document details the query interfaces, funnel calculations, and data contracts for the **Event Analytics Module**.

---

## 1. Funnel Query Mechanics

```mermaid
sequenceDiagram
    autonumber
    actor Analyst as Product Manager / Engineer
    participant API as Event Analytics API
    participant QB as Dynamic Query Builder
    participant DB as Log DB Event Store

    Analyst->>API: POST /api/v1/event-analytics/funnel { steps: ["page_view", "sign_up", "checkout"], window: "7d" }
    API->>QB: buildFunnelQuery(steps, projectId, timeRange)
    QB->>QB: Generate Windowed CTEs & LAG() Queries
    QB->>DB: Execute Parameterized SQL
    DB-->>QB: Return Conversion Counts & Drop-off Times
    QB-->>API: Format Funnel Steps & Conversion Percentages
    API-->>Analyst: 200 OK (Funnel JSON Breakdown)
```

---

## 2. API Endpoints

- **`POST /api/v1/event-analytics/funnel`**: Executes multi-step conversion funnel analysis.
- **`GET /api/v1/event-analytics/retention`**: Computes cohort retention matrix.
- **`GET /api/v1/event-analytics/events`**: Searches custom events with arbitrary JSONB property filters.
- **`GET /api/v1/event-analytics/export`**: Streams CSV export of events.

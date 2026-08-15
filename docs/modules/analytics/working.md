# Analytics Module (v1) Working & Operational Guide

This document details the operational endpoints, query parameters, data formatting, and caching mechanics of the **Analytics Module (v1)**.

---

## 1. Endpoints & Query Contracts

### 1.1 Overview Metrics
- **Endpoint**: `GET /api/v1/analytics/overview`
- **Headers**: `Authorization: Bearer <JWT_OR_API_KEY>`
- **Query Parameters**:
  - `projectId` (UUID, required): The target project ID.
  - `timeRange` (string, optional: `1h`, `24h`, `7d`, `30d`, default: `24h`).
  - `environment` (string, optional: `production`, `staging`, `development`).

#### Example Response `200 OK`:
```json
{
  "success": true,
  "data": {
    "summary": {
      "totalRequests": 1425000,
      "totalErrors": 2850,
      "errorRate": 0.002,
      "p50LatencyMs": 14.2,
      "p95LatencyMs": 85.6,
      "p99LatencyMs": 210.4,
      "apdexScore": 0.985
    },
    "timeseries": [
      {
        "timestamp": "2026-08-14T06:00:00.000Z",
        "requests": 59400,
        "errors": 118,
        "p95LatencyMs": 82.1
      }
    ]
  }
}
```

---

### 1.2 Endpoint Performance Breakdown
- **Endpoint**: `GET /api/v1/analytics/endpoints`
- **Query Parameters**: `projectId`, `timeRange`, `limit` (default: 50), `sortBy` (`requests`, `p95Latency`, `errorRate`).
- **Response**: Array of top endpoints with HTTP methods, call counts, error percentages, and latency percentiles.

---

## 2. In-Memory Caching Mechanics

- Key formulation: `analytics:${projectId}:${environment}:${route}:${hash(query)}`.
- Default TTL: 60 seconds (prevents database thrashing during multi-user dashboard polling).
- Cache invalidation: Automatic time-based expiration.

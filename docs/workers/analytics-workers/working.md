# Analytics Worker Tier Working & Operational Guide

This document describes the operational execution, watermark tracking, and health monitoring for the **Analytics Worker Tier**.

---

## 1. Health & Prometheus Endpoints

The analytics worker runs a dedicated HTTP server on port 9092:
- **`GET /health`**: Returns detailed worker health snapshot:
```json
{
  "status": "healthy",
  "uptimeSeconds": 14520,
  "logDb": "connected",
  "queue": "connected",
  "worstLagSeconds": 8.4,
  "workers": [
    { "id": "requests", "lagSeconds": 4.2, "status": "healthy", "consecutiveFailures": 0 },
    { "id": "errors", "lagSeconds": 5.1, "status": "healthy", "consecutiveFailures": 0 }
  ]
}
```
- **`GET /metrics`**: Prometheus exposition metrics (`analytics_worker_watermark_lag_seconds`, `analytics_worker_rows_read_total`).

---

## 2. Process Management

```bash
# Start locally
npm run dev:analytics

# Start in production
npm run start:analytics

# Start with PM2
npx pm2 start ecosystem.config.cjs --only analytics-workers
```

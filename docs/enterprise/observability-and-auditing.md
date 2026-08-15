# Enterprise Observability, Telemetry & Audit Architecture

This document describes the telemetry pipeline, Prometheus metric exposition, Pino structured JSON logging, and security auditing standards across the **Pulsiv SaaS Backend**.

---

## 1. Structured JSON Logging Architecture

All services output structured JSON via **Pino**, configured with correlation IDs and component tags:

```json
{
  "level": 30,
  "time": 1723621200000,
  "pid": 4120,
  "hostname": "api-prod-01",
  "component": "ingestion",
  "reqId": "req_884920b7-951c-4b82-8419-f9c34a2e21b8",
  "method": "POST",
  "url": "/api/v1/traces",
  "durationMs": 6.8,
  "statusCode": 202,
  "msg": "Ingestion request completed"
}
```

---

## 2. Prometheus Metric Exposition Endpoints

| Metric Endpoint | Scraped Component | Key Metrics Exposed |
| :--- | :--- | :--- |
| `GET /metrics` (Port 3000) | Fastify API Gateway | `http_requests_total`, `http_request_duration_seconds`, `event_loop_lag_seconds`, `heap_used_bytes` |
| `GET /metrics` (Port 9091) | Ingestion Worker Process | `ingest_queue_depth`, `ingest_events_persisted_total`, `ingest_batch_duration_ms` |
| `GET /metrics` (Port 9092) | Analytics Worker Process | `analytics_worker_watermark_lag_seconds`, `analytics_worker_rows_read_total`, `analytics_worker_consecutive_failures` |

---

## 3. Health & Readiness Probes

- **`/health/live`**: Fast process liveness check for Kubernetes/Docker container restarts.
- **`/health/ready`**: Deep readiness probe verifying database connectivity, pg-boss queue readiness, and memory headroom.

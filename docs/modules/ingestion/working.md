# Ingestion Module Working & Operational Guide

This document describes the operational workflow, request/response contracts, validation pipeline, and internal mechanics of the **Ingestion Module**.

---

## 1. Request Lifecycle Step-by-Step

```mermaid
sequenceDiagram
    autonumber
    actor SDK as Client SDK / Application
    participant GW as Fastify Ingestion Gateway
    participant Cache as In-Memory LRU Auth Cache
    participant RL as Rate Limiter (Token Bucket)
    participant Norm as Event Normalizer
    participant Usage as Usage Rollup Buffer
    participant Queue as pg-boss Ingestion Queue

    SDK->>GW: POST /api/v1/errors (Authorization: Bearer <API_KEY>)
    GW->>GW: JSON-Schema Validation (AJV Compiler)
    alt Schema Validation Fails
        GW-->>SDK: 400 Bad Request (Validation Details)
    end
    GW->>Cache: Lookup API Key Cache
    alt Cache Miss
        GW->>GW: Query DB (Prefix + Constant-Time Hash)
        GW->>Cache: Set Key Context (TTL: 5 min)
    end
    GW->>RL: Check Limits (Org & Project Rate Windows)
    alt Rate Limit Exceeded
        GW-->>SDK: 429 Too Many Requests (Retry-After)
    end
    GW->>Norm: Sanitize & Validate Events
    GW->>Usage: Increment Staged Usage Counter
    GW->>Queue: Publish Batch Job (queue: ingest-error)
    GW-->>SDK: 202 Accepted { success: true, accepted: N, batchId: "..." }
```

---

## 2. API Endpoint Specifications

### 2.1 SDK Initialization & Configuration Delivery
- **Endpoint**: `POST /api/v1/init`
- **Authentication**: `Authorization: Bearer <API_KEY>` or `X-API-Key: <API_KEY>`
- **Description**: Delivers the compiled SDK configuration (sampling rates, enabled integrations, route URLs, rate limits) to the client SDK.
- **Request Body**:
```json
{
  "sdk": {
    "name": "@pulse/browser",
    "version": "2.4.0",
    "platform": "browser"
  },
  "environment": "production"
}
```
- **Response `200 OK`**:
```json
{
  "success": true,
  "data": {
    "projectId": "11111111-2222-3333-4444-555555555555",
    "environment": "production",
    "revision": 12,
    "features": {
      "errors": true,
      "traces": true,
      "metrics": true,
      "logs": true,
      "replays": false
    },
    "sampling": {
      "traces": 0.2,
      "errors": 1.0,
      "profiles": 0.05
    },
    "routes": {
      "errors": "https://api.pulsiv.io/api/v1/errors",
      "requests": "https://api.pulsiv.io/api/v1/requests",
      "traces": "https://api.pulsiv.io/api/v1/traces",
      "metrics": "https://api.pulsiv.io/api/v1/metrics",
      "logs": "https://api.pulsiv.io/api/v1/logs"
    }
  }
}
```

---

### 2.2 Typed Event Ingestion Endpoints
All typed ingestion endpoints share the canonical `IngestSchema` payload structure:
- `POST /api/v1/errors` (Error payloads only)
- `POST /api/v1/requests` (HTTP request/response telemetry)
- `POST /api/v1/traces` (Distributed traces)
- `POST /api/v1/spans` (Individual OpenTelemetry spans)
- `POST /api/v1/metrics` (Counters, gauges, histograms)
- `POST /api/v1/logs` (Application logs)
- `POST /api/v1/profiles` (CPU/Memory profiler traces)
- `POST /api/v1/events` (Custom messages & events)
- `POST /api/v1/checkins` (Cron monitor heartbeat)
- `POST /api/v1/replays` (Session replay chunks)

#### Example Request: `POST /api/v1/errors`
```json
{
  "metadata": {
    "sdkVersion": "2.4.0",
    "environment": "production",
    "batchId": "b1b369c0-9943-4dc7-8a62-79ee898ecfe7",
    "compression": "none"
  },
  "events": [
    {
      "id": "e30e1074-b5f7-4ebc-bd87-19c4bc2173f4",
      "type": "error",
      "timestamp": "2026-08-14T07:30:00.000Z",
      "payload": {
        "message": "Database connection pool exhausted",
        "name": "PoolExhaustionError",
        "stack": "PoolExhaustionError: Database connection pool exhausted\n    at Pool.connect (/app/dist/db.js:42:15)",
        "fingerprint": ["PoolExhaustionError", "db.js:42"],
        "severity": "critical"
      },
      "context": {
        "service": "billing-service",
        "version": "1.8.2",
        "runtime": "node:20.12.0",
        "host": "ip-10-0-12-84"
      }
    }
  ]
}
```

#### Example Response: `202 Accepted`
```json
{
  "success": true,
  "data": {
    "accepted": 1,
    "rejected": 0,
    "batchId": "b1b369c0-9943-4dc7-8a62-79ee898ecfe7"
  },
  "requestId": "req_884920b7-951c-4b82-8419-f9c34a2e21b8"
}
```

---

## 3. Rate Limiting Mechanics

1. **Per-Second Sliding Bucket**: Enforces hard bursts (default: 500 req/sec per project).
2. **Per-Minute Window**: Prevents continuous high-volume saturation (default: 10,000 req/min).
3. **Plan Tier Scaling**:
   - `developer`: 100 req/sec | 2,000 req/min
   - `team`: 500 req/sec | 15,000 req/min
   - `enterprise`: 5,000 req/sec | 150,000 req/min
4. **Header Extraction**: API keys are strictly read from headers (`Authorization` or `X-API-Key`) to prevent secret leakage in query params.

---

## 4. Local Testing & Verification

To verify the Ingestion module locally:

```bash
# 1. Start the API Gateway
npm run dev

# 2. Issue a test POST request with a valid project API key
curl -X POST http://localhost:3000/api/v1/errors \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer pk_live_sample_key_123" \
  -d '{
    "metadata": { "environment": "development" },
    "events": [{
      "id": "e30e1074-b5f7-4ebc-bd87-19c4bc2173f4",
      "type": "error",
      "timestamp": "2026-08-14T07:30:00.000Z",
      "payload": { "name": "TypeError", "message": "Cannot read properties of null" }
    }]
  }'
```

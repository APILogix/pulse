# Environment Variables & Connection Pool Sizing Reference

This document provides a comprehensive reference for all environment variables, security secrets, admission control thresholds, and database connection pool sizing formulas for the **Pulsiv Backend**.

---

## 1. Core Server & Security Secrets

| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | Yes | `development` | Runtime environment (`production`, `staging`, `development`). |
| `PROCESS_ROLE` | Yes | `api` | Process role (`api`, `worker`, `ingestion`, `analytics`, `cron`). |
| `PORT` | No | `3000` | HTTP listening port for Fastify API. |
| `HOST` | No | `0.0.0.0` | HTTP bind host. |
| `JWT_SECRET` | Yes | - | Secret key used to sign and verify user session JWTs. |
| `JWT_REFRESH_SECRET` | Yes | - | Secret key for refresh tokens. |
| `COOKIE_SECRET` | Yes | - | Dedicated secret for signing HttpOnly session cookies (Do NOT reuse `JWT_SECRET`). |
| `ENCRYPTION_KEY` | Yes | - | Exactly 32-character key for AES-256-GCM encryption of integration secrets. |
| `ALLOWED_ORIGINS` | No | `http://localhost:5173` | Comma-separated CORS allowed origin URLs. |

---

## 2. Database Connection Strings & Pool Configuration

| Variable | Description | Recommended Production Value |
| :--- | :--- | :--- |
| `DATABASE_URL` | Primary PostgreSQL connection string. | `postgresql://user:pass@ep-pooler.neon.tech/pulse?sslmode=require` |
| `LOG_DB_PRIMARY` | Dedicated Log DB PostgreSQL connection string. | `postgresql://user:pass@ep-logdb.neon.tech/pulse_logs?sslmode=require` |
| `DB_POOL_MAX` | Max pool connections for Primary DB. | `20` (per PM2 process) |
| `DB_POOL_MIN` | Minimum warm connections. | `0` (for serverless poolers) |
| `DB_STATEMENT_TIMEOUT_MS` | Max SQL execution time before cancellation. | `15000` (15s) |
| `INGESTION_DB_POOL_SIZE` | Dedicated connection pool for Ingestion Worker. | `20` |
| `ANALYTICS_DB_POOL_MAX` | Dedicated connection pool for Analytics Worker. | `10` |

---

## 3. Admission Control & Backpressure Safeguards

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PRESSURE_MAX_EVENT_LOOP_DELAY_MS` | `2000` | Max event loop delay before shedding work with HTTP 503. |
| `PRESSURE_MAX_HEAP_MB` | `450` | Maximum heap allocation threshold before shedding. |
| `PRESSURE_MAX_RSS_MB` | `800` | Maximum RSS process memory threshold. |
| `INGESTION_MAX_BATCH_SIZE` | `500` | Max events allowed in a single HTTP batch request. |
| `INGESTION_DEFAULT_RATE_PER_SECOND` | `500` | Default project burst rate limit. |
| `INGESTION_DEFAULT_RATE_PER_MINUTE` | `10000` | Default project minute rate limit. |

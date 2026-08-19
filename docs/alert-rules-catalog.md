# Alert Rules Catalog

Comprehensive reference of all alert rules, presets, templates, and operational thresholds in the platform, cleanly categorized into **Fast Lookup (Instant / Ingestion Tier)** and **Analytics (Window / Rollup Tier)**.

---

## 1. Fast Lookup Rules (Instant / Telemetry Ingestion Tier)

Fast Lookup rules are evaluated **in-memory immediately upon telemetry arrival** via the `alert.evaluate.fast` queue. They do **not** query historical database rollups or background aggregation jobs. They trigger and page on-call engineers within sub-second latency.

| Rule Name | Preset Key | Severity | Field Path | Operator | Threshold | Cooldown | Dedupe Window | Trigger Condition Description |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Unhandled Exception** | `unhandled_exception_fast` | `critical` | `errors.unhandled` | `eq` | `true` | 300s (5m) | 3600s (1h) | Any unhandled exception telemetry event. |
| **Fatal Exception** | `fatal_exception_fast` | `critical` | `errors.fatal` | `eq` | `true` | 300s (5m) | 3600s (1h) | Any fatal or critical level exception. |
| **Process Crash** | `process_crash_fast` | `critical` | `errors.crash` | `eq` | `true` | 300s (5m) | 3600s (1h) | Crash-class error event or container crash. |
| **Out of Memory** | `out_of_memory_fast` | `critical` | `logs.oom` | `eq` | `true` | 300s (5m) | 3600s (1h) | Out-of-memory error pattern detected in log telemetry. |
| **Cron Check-in Failed** | `cron_failed_fast` | `error` | `cron.failed` | `eq` | `true` | 600s (10m) | 3600s (1h) | Failed cron check-in or missed execution signal. |
| **Security Event** | `security_event_fast` | `critical` | `logs.security` | `eq` | `true` | 300s (5m) | 3600s (1h) | Critical security-tagged log or breach telemetry. |
| **Authentication Failure** | `auth_failure_fast` | `critical` | `requests.auth_failure`| `eq` | `true` | 300s (5m) | 1800s (30m)| HTTP 401 / 403 authorization breach. |
| **Heartbeat Lost** | `heartbeat_lost_fast` | `critical` | `heartbeat.lost` | `eq` | `true` | 600s (10m) | 3600s (1h) | Heartbeat timeout or dropped node signal. |
| **Deployment Failed** | `deployment_failed_fast`| `critical` | `deployment.failed`| `eq` | `true` | 600s (10m) | 3600s (1h) | Deployment failure event emitted by CI/CD pipeline. |
| **Connector Open Circuit**| `connector_open_circuit_fast`| `critical` | `connector.failure` | `eq` | `true` | 600s (10m) | 3600s (1h) | Outbound connector (webhook/Slack/etc.) circuit tripped. |

---

## 2. Analytics Rules (Window / Aggregation / Rollup Tier)

Analytics rules evaluate **time-windowed aggregations and rollups** (5m to 60m windows) against telemetry tables and ClickHouse / LogDB data to detect metric trends, latency degradation, and volume anomalies.

| Rule Name | Preset Key | Severity | Field Path | Operator | Threshold | Lookback Window | Eval Interval | Description |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **High Error Rate** | `high_error_rate` | `error` | `errors.rate` | `>=` | `5%` | 5 min | 60s | Error percentage exceeds 5% of all requests. |
| **High Latency (P95)** | `high_latency_p95` | `warning` | `requests.latency.p95` | `>=` | `2,000 ms` | 5 min | 60s | 95th percentile response latency exceeds 2,000ms. |
| **Elevated 5xx Responses** | `elevated_5xx` | `error` | `requests.error_rate` | `>=` | `2%` | 5 min | 60s | 5xx HTTP status responses exceed 2% of total traffic. |
| **Failed Cron Check-ins** | `failed_cron` | `error` | `cron.failures` | `>=` | `1` | 15 min | 120s | One or more cron check-ins reported failure. |
| **Service Inactivity** | `service_inactivity` | `warning` | `requests.count` | `<` | `1` | 10 min | 120s | Zero requests observed in 10 minutes (service down/isolated). |
| **Availability Degradation**| `availability_degradation`| `critical` | `requests.degraded_rate`| `>=` | `10%` | 5 min | 60s | Degraded requests (5xx or >10s latency) exceed 10%. |
| **Traffic Volume Spike** | `traffic_spike` | `info` | `requests.count` | `>=` | `10,000` | 5 min | 60s | Sudden request volume surge above baseline. |
| **Log Error Burst** | `log_error_burst` | `warning` | `logs.error_count` | `>=` | `25` | 5 min | 60s | High volume of error-level log lines in window. |
| **Error Volume Spike** | `error_volume_spike` | `error` | `errors.count` | `>=` | `50` | 5 min | 60s | Absolute count of exception errors exceeds 50. |
| **High Latency (P99)** | `high_latency_p99` | `error` | `requests.latency.p99` | `>=` | `5,000 ms` | 5 min | 60s | 99th percentile response latency exceeds 5,000ms. |
| **Cron Failure Rate** | `cron_failure_rate` | `error` | `cron.failure_rate` | `>=` | `25%` | 5 min | 10s | Cron failure rate exceeds 25% across executions. |
| **Request Inactivity** | `request_inactivity` | `warning` | `requests.inactivity_minutes`| `>=` | `15 min` | 30 min | 120s | Inactivity detected for more than 15 consecutive minutes. |
| **Out-of-Memory Logs** | `out_of_memory_logs` | `critical` | `logs.matches` | `contains` | `'out of memory'` | 15 min | 120s | Out of memory error signatures present in logs. |
| **Database Connection Errors (Logs)** | `database_connection_logs` | `error` | `logs.matches` | `contains` | `'connection refused'` | 15 min | 120s | Database refusal or timeout signatures in logs. |
| **High CPU Usage** | `high_cpu_usage` | `warning` | `metrics.cpu.usage` | `>=` | `85%` (avg) | 10 min | 120s | Average CPU usage exceeds 85%. |
| **High Memory Usage** | `high_memory_usage` | `warning` | `metrics.memory.usage` | `>=` | `85%` (avg) | 10 min | 120s | Average memory usage exceeds 85%. |
| **Queue Backlog** | `queue_backlog` | `warning` | `queue.backlog` | `>=` | `1,000` | 10 min | 30s | Message queue pending backlog exceeds 1,000 items. |
| **Database Connection Error Rollup** | `db_connection_errors` | `error` | `db.connection_errors` | `>=` | `5` | 10 min | 30s | Total database connection errors exceed 5. |
| **Service Health Degradation** | `service_health_degradation` | `warning` | `service.health` | `<` | `90` | 10 min | 30s | Overall service health score drops below 90%. |
| **Endpoint Health Degradation** | `endpoint_health_degradation` | `warning` | `endpoint.health` | `<` | `90` | 10 min | 30s | Specific endpoint health score drops below 90%. |
| **AI Failed Requests** | `ai_failed_requests` | `error` | `ai.requests.failed` | `>=` | `1` | 15 min | 120s | Failed or timed-out AI LLM inferences. |
| **AI Slow Requests (P95)** | `ai_slow_requests_p95`| `warning` | `ai.duration.p95` | `>=` | `10,000 ms` | 15 min | 120s | P95 AI response latency exceeds 10 seconds. |
| **AI Failure Rate** | `ai_failure_rate` | `error` | `ai.failure_rate` | `>=` | `10%` | 5 min | 10s | AI failure rate exceeds 10% in window. |
| **AI Credit Burn Spike** | `ai_credit_burn_spike` | `warning` | `ai.credits.used` | `>=` | `500` | 60 min | 300s | Rapid consumption of AI credits (>500 in 1 hour). |
| **AI Cost Spike** | `ai_cost_spike` | `warning` | `ai.cost.usd` | `>=` | `$10.00` | 60 min | 300s | Estimated AI provider cost exceeds $10 in 1 hour. |

---

## 3. Optional Library Templates

Templates available for orgs to instantiate on demand:

| Template Key | Template Name | Category | Field Path | Threshold | Lookback | Severity |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `disk_usage_high` | **High Disk Usage** | `observability` | `metrics.disk.usage` | `>= 85%` (avg) | 10 min | `warning` |
| `queue_lag_high` | **High Queue Lag** | `observability` | `metrics.queue.lag` | `>= 1,000` (avg) | 10 min | `warning` |
| `cache_error_logs` | **Cache Error Logs** | `observability` | `logs.matches` | `'cache timeout'` | 15 min | `error` |
| `auth_failure_spike` | **Auth Failure Spike** | `security` | `logs.matches` | `'authentication failed'` | 15 min | `warning` |
| `webhook_delivery_failures`| **Webhook Delivery Failures**| `integration` | `logs.matches` | `'webhook delivery failed'`| 15 min | `error` |
| `payment_failure_spike` | **Payment Failure Spike** | `billing` | `metrics.payment.failures` | `>= 5` (avg) | 10 min | `error` |
| `ai_token_volume_spike` | **AI Token Volume Spike** | `ai` | `ai.tokens.used` | `>= 100,000` | 60 min | `warning` |

---

## 4. Project Operational Thresholds

Configured at the project level (`project_alert_thresholds`) for automated threshold monitoring:

| Metric Key | Metric Name | Category | Default Severity | Default Threshold | Unit | Evaluation Window |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `latency_p50` | `latency_ms_p50` | `performance` | `warning` | `>= 500` | `ms` | 5 min |
| `latency_p75` | `latency_ms_p75` | `performance` | `warning` | `>= 750` | `ms` | 5 min |
| `latency_p90` | `latency_ms_p90` | `performance` | `warning` | `>= 1,000` | `ms` | 5 min |
| `latency_p95` | `latency_ms_p95` | `performance` | `error` | `>= 1,500` | `ms` | 5 min |
| `latency_p99` | `latency_ms_p99` | `performance` | `critical` | `>= 2,500` | `ms` | 5 min |
| `error_rate` | `error_rate` | `performance` | `error` | `>= 5` | `percent` | 5 min |
| `apdex` | `apdex` | `performance` | `warning` | `<= 0.85` | `score` | 5 min |
| `event_volume_spike` | `total_events` | `performance` | `warning` | `>= 200` | `percent` | 5 min |
| `event_volume_drop` | `total_events` | `performance` | `warning` | `<= 50` | `percent` | 5 min |
| `failed_notification_rate`| `failed_notifications` | `performance` | `error` | `>= 10` | `percent` | 5 min |
| `ingestion_error_rate` | `ingestion_errors` | `performance` | `error` | `>= 5` | `percent` | 5 min |
| `rate_limit_usage` | `rate_limit_usage` | `performance` | `warning` | `>= 80` | `percent` | 5 min |
| `ai_usage_cost` | `ai_cost` | `performance` | `warning` | `>= 100` | `currency` | 5 min |

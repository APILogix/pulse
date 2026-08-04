# Phase 18 — Analytics Lineage Graph

Every number a user sees is traceable to the originating telemetry event. The
lineage below is complete for all 26 workers; each chain reads
`event → table → worker → rollup → API → widget → downstream consumers`.

---

## 1. Master lineage

```
                          ┌──────────────── SDK / agent ────────────────┐
                          │ request  error  log  metric  span  trace    │
                          │ message  profile  replay  cron_checkin      │
                          └───────────────────┬─────────────────────────┘
                                              │ Ingestion API → pg-boss → Ingestion Worker
                                              ▼
   events_requests  events_errors  events_logs  events_metrics  events_spans
   events_traces    events_messages  events_profiles  events_replays  events_cron_checkins
                                              │ (read-only, watermark on ingested_at)
        ┌──────────┬──────────┬──────────┬────┴─────┬──────────┬──────────┬──────────┐
        ▼          ▼          ▼          ▼          ▼          ▼          ▼          ▼
    requests   endpoints  services    errors      logs      metrics   runtime     spans
        │          │          │          │          │          │          │          │
 request_metrics_1m │  service_metrics_1m │   log_metrics_1m   │  runtime_metrics_1m │
        │   endpoint_metrics_1m       error_metrics_1m   metric_series_1m   gc_metrics_1m
        │          │          │     error_group_metrics_1m       │      span_metrics_1m
        │          │          │     error_dimension_metrics_1h   │      db_metrics_1h
        │          │          │                                  │   dependency_metrics_1h
        ▼          ▼          ▼          ▼          ▼          ▼          ▼          ▼
                       analytics.compaction  (1m → 5m → 1h → 1d)
                                              │
                                              ▼
                       /analytics/v2/*  (rollup-only read repositories)
                                              │
                          ┌───────────────────┼───────────────────┐
                          ▼                   ▼                   ▼
                      Dashboards          Alert rules          AI context
```

Rollup-on-rollup chains:
```
request_metrics_1m ─┐
error_metrics_1m  ─┼─► analytics.health   ─► project_health_5m   ─► project cards
service_metrics_1m ─┘
service_metrics_1m ──► analytics.slo      ─► slo_metrics_5m      ─► SLO board, burn-down
*_metrics_1h       ──► analytics.anomalies─► anomaly_detections  ─► anomaly feed, root cause
```

Cross-domain read-only chains (documented exceptions, still Log DB only):
```
alert_events, alert_delivery_attempts, alert_acknowledgments ─► analytics.alerts ─► alert_metrics_1h ─► /alerts/metrics
ai_requests, ai_responses, ai_usage_receipts                 ─► analytics.ai     ─► ai_metrics_1h    ─► /ai/usage
ingestion_failures                                           ─► analytics.usage  ─► ingest_health_metrics_5m ─► /ingestion/health
```

---

## 2. Per-metric lineage chains

### 2.1 Request rate card (the prompt's worked example)
```
Request Event
  ↓ Ingestion API (POST /ingest/requests)
  ↓ pg-boss queue ingestion.requests
  ↓ TelemetryWriter.writeRequests
events_requests (partition events_requests_YYYY_MM_DD)
  ↓ analytics.requests  [watermark: ingested_at]
request_metrics_1m (bucket = date_trunc('minute', timestamp))
  ↓ analytics.compaction
request_metrics_5m → request_metrics_1h → request_metrics_1d
  ↓ AnalyticsRequestReadRepository.getSummary()
GET /analytics/v2/requests/summary
  ↓ MetricCard{ key:'requests.total', value, delta, trend, direction, aiContext }
Project Dashboard → Request Rate Card
  ↓ aiContext
AI: Traffic Trend summary
  ↓ metric key 'requests.total'
Alert: High Request Rate / Traffic Drop
```

### 2.2 Error rate + top error groups
```
Error Event → events_errors
  ↓ analytics.errors
error_metrics_1m ──────────────► /v2/errors/summary → "Total errors", "Affected users"
error_group_metrics_1m ─┬──────► /v2/errors/groups  → triage queue rows + trend sparkline
                        └─ 1h ──► regression_score  → /v2/errors/regressions → banner
analytics_error_groups ────────► group state (status, priority, assignee)
error_dimension_metrics_1h ────► /v2/errors/dimensions → mechanism donut, service impact
  ↓
Alert: New Error Group, Error Regression
AI: Error Group Investigation, Regression Root Cause
```

### 2.3 Latency percentiles + heatmap
```
Request Event → events_requests.latency_ms
  ↓ analytics.requests (percentile_cont + 24-bucket log histogram)
request_metrics_1m.latency_p50..p99 + latency_hist
  ↓ analytics.compaction (element-wise histogram merge, percentiles recomputed)
request_metrics_5m/1h/1d
  ↓ /v2/requests/summary          → P50–P99 hero cards
  ↓ /v2/requests/latency-histogram → distribution + heatmap rows
  ↓ /v2/endpoints                  → per-route percentile table
Alert: High Latency, Latency Regression
AI: Latency Regression Analysis, Slow-Path Attribution
```

### 2.4 Service map
```
Span Event → events_spans (service, parent_span_id, trace_id, duration_ms, status)
Trace Event → events_traces (span_count, total_duration_ms, is_partial)
  ↓ analytics.traces (self-join spans on parent_span_id within trace)
trace_edge_metrics_1h (source_service > target_service, call_count, error_count, latency_hist)
trace_metrics_1m (trace counts, partial rate, duration percentiles)
  ↓ /v2/traces/service-map → nodes[] + edges[]
/dashboards/tracing → Service Dependency Map
Alert: Edge Error Rate
AI: Topology Analysis
```

### 2.5 Database query performance
```
Span Event with db.* attributes → events_spans.db_system/db_operation/db_statement
  ↓ analytics.spans  (statement_pattern = regexp_replace(db_statement,'\d+','?','g')[:200])
db_metrics_1h (call_count, error_count, latency percentiles per pattern)
  ↓ /v2/spans/databases → DataTable
/dashboards/tracing → Database Query Performance
Alert: Slow Query
AI: Query Optimisation
```

### 2.6 Geo + device breakdown
```
Request Event → events_requests.geo_country_code / geo_region / browser_family / os_name / device_type
  ↓ analytics.geo (joined to geo_countries for display names)
geo_metrics_1h, device_metrics_1h
  ↓ /v2/geo/countries, /v2/geo/devices
/dashboards/geo → choropleth, country table, browser donut, OS bars
AI: Geo Distribution Insight, Client Failure Analysis
```

### 2.7 Runtime diagnostics
```
Metric Event (metric_name='runtime.heap.used' | 'runtime.eventloop.lag' | 'runtime.gc.pause')
  ↓ events_metrics
  ↓ analytics.runtime
runtime_metrics_1m (heap/rss/handles/lag/utilization) , gc_metrics_1m (pauses per gc_type)
  ↓ analytics.compaction → *_1h
  ↓ /v2/runtime/memory | /v2/runtime/event-loop | /v2/runtime/gc
/observability/runtime (3 tabs)
Alert: Event Loop Lag, GC Long Pause
AI: Memory Growth Analysis
```

### 2.8 Cron monitoring
```
Cron Check-in Event → events_cron_checkins (monitor_slug, status, duration_ms)
  ↓ analytics.crons
cron_metrics_1m (outcome counters, duration percentiles)
cron_monitor_state (last status, expected interval, consecutive failures, is_missing)
  ↓ /v2/crons/summary, /v2/crons/monitors
/observability/crons → KPI cards + monitor board
Alert: Missed Cron Run
AI: Cron Failure Diagnosis
```

### 2.9 Sessions, users, crash-free rate
```
Request Event (session_id, user_id) ─┐
Error Event (severity='fatal')      ─┴─► analytics.sessions
analytics_user_sessions (session facts, is_crashed)
session_metrics_1h (session count, crash-free rate, duration percentiles, HLL users)
user_metrics_1d (DAU exact + HLL, new/returning)
  ↓ /v2/sessions/summary
/dashboards/geo (DAU/MAU) , /dashboards/errors (crash-free) , /dashboards/releases
Alert: Crash-Free SLO
AI: Stability Summary
```

### 2.10 Release verdict
```
Request Event.release + Error Event.release + release_lookup
  ↓ analytics.releases
release_metrics_1h (per-release traffic, errors, latency, new groups, adoption share)
release_comparison  (deltas vs baseline release + verdict)
  ↓ /v2/releases, /v2/releases/:release/comparison, /v2/releases/:release/new-errors
/dashboards/releases → comparison table, adoption curve, verdict banner
/dashboards/performance → by-release tab
Alert: Release Regression
AI: Rollback Advice
```

### 2.11 SLO burn rate
```
events_requests → analytics.requests → request_metrics_1m
                → analytics.services → service_metrics_1m
  ↓ analytics.slo (SLO definitions cached from the control plane)
slo_metrics_5m (attainment, error budget consumed, burn_rate_1h/6h/24h)
  ↓ /v2/slos
/services/slos , /dashboards/executive burn-down
Alert: Fast Burn (14.4×), Slow Burn (6×)
AI: Error Budget Forecast
```

### 2.12 Usage → cost
```
all events_* row counts + pg_column_size(payload) sample
  ↓ analytics.usage
usage_metrics_1d (event_count, billable_count, bytes_estimate per signal)
  ↓ + unit cost from billing module service
cost_metrics_1d (estimated_cost_micros, cost_per_million_micros)
  ↓ /v2/usage/signals , /v2/cost/summary
/billing/usage , project usage , /dashboards/infrastructure cost cards
Alert: Quota Threshold, Cost Spike
AI: Usage Forecast, Cost Optimisation
```

### 2.13 Ingestion health
```
events_* (ingested_at − occurred_at)  +  ingestion_failures (error_code)
  ↓ analytics.usage
ingest_health_metrics_5m (accepted, rejected, dropped, reasons JSONB, lag percentiles)
  ↓ /v2/ingestion/health
/ingestion/health , /dashboards/realtime saturation panel
Alert: Ingestion Rejection Spike, Ingest Lag
AI: Pipeline Advice
```

### 2.14 Security posture
```
Request Event (401/403/429, client_ip_hash, route, api_key_id, geo_country_code)
Error Event (jwt/token/signature/expired patterns)
  ↓ analytics.security
security_metrics_1h (auth failures, rate limits, sensitive access, risk score per entity)
  ↓ /v2/security/summary , /top-offenders , /sensitive-access
/dashboards/security
Alert: Brute Force, Sensitive Access Spike
AI: Threat Summary, Block Recommendation
```

### 2.15 Anomaly detection → root cause
```
request_metrics_1h , error_metrics_1h , log_metrics_1h , latency columns
  ↓ analytics.anomalies (7-day same-hour-of-week baseline, 3σ threshold)
anomaly_detections (metric_key, observed, baseline, deviation_sigma, context)
  ↓ /v2/anomalies , /v2/anomalies?correlate=true
/insights/anomalies , /insights/root-cause
AI: Root Cause Analysis (consumes context + correlated metrics)
Alert: Anomaly Detected
```

### 2.16 Alerts and AI self-observability
```
alert_events + alert_delivery_attempts + alert_acknowledgments
  ↓ analytics.alerts → alert_metrics_1h → /v2/alerts/metrics → /alerts/metrics

ai_requests + ai_responses + ai_usage_receipts
  ↓ analytics.ai → ai_metrics_1h → /v2/ai/usage → /ai/usage , /ai overview
```

---

## 3. Traceability guarantees

1. Every rollup row records `sample_count`, so any displayed aggregate can be
   traced to the number of raw rows behind it.
2. Every rollup row's `(organization_id, project_id, environment, bucket)` maps
   directly to a bounded raw query
   `WHERE organization_id=… AND project_id=… AND environment=… AND timestamp >= bucket AND timestamp < bucket + window`,
   which the API exposes as a "view source events" deep link on every widget.
3. Every worker run is recorded in `analytics_worker_runs` with the exact window
   it consumed, so a wrong number can be attributed to a specific run.
4. `meta.freshness.watermark` on every response states exactly how current the
   displayed number is.
5. No widget reads a table that is not in this graph — asserted by the
   read-repository test that forbids `FROM events_` outside the declared raw-detail
   routes.

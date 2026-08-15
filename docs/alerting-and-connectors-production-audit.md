# Production Audit Report: Alerting, Notification, Worker & Connector Architecture

**System:** Pulsiv API Observability SaaS Backend  
**Audit Scope:** Alerting, Rules, Evaluation Tiers, Lifecycle, Ingestion Outbox, Analytics Rollups, Entitlements, Routing, Workers, Queues, Security, Database Schema, and Connectors (Slack, Discord, Teams, PagerDuty, Email, SMS, Webhook).  
**Audit Mode:** READ-ONLY Architectural Audit.

---

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [1. Alerting Module Inventory](#1-alerting-module-inventory)
3. [2. Alert Rule Audit](#2-alert-rule-audit)
4. [3. Ingestion Audit](#3-ingestion-audit)
5. [4. Analytics Audit](#4-analytics-audit)
6. [5. Alert Lifecycle Audit](#5-alert-lifecycle-audit)
7. [6. Subscription & Entitlement Audit](#6-subscription--entitlement-audit)
8. [7. Routing Audit](#7-routing-audit)
9. [8. Connector Module Audit](#8-connector-module-audit)
10. [9. Worker Audit](#9-worker-audit)
11. [10. Queue Audit](#10-queue-audit)
12. [11. Reliability & Idempotency Audit](#11-reliability--idempotency-audit)
13. [12. Security Audit](#12-security-audit)
14. [13. Database Schema & Indexing Audit](#13-database-schema--indexing-audit)
15. [14. Observability Audit](#14-observability-audit)
16. [15. Performance Audit](#15-performance-audit)
17. [16. Failure Matrix](#16-failure-matrix)
18. [17. Ranked Findings (P0, P1, P2, P3)](#17-ranked-findings)
19. [18. Architectural Strengths](#18-architectural-strengths)
20. [19. Architectural Weaknesses](#19-architectural-weaknesses)
21. [20. Recommended Target Architecture](#20-recommended-target-architecture)
22. [21. Recommended Change Plan](#21-recommended-change-plan)

---

## Executive Summary

This report delivers a complete, read-only architectural audit of the alerting and connector infrastructure.

The platform implements a multi-tenant API observability SaaS designed around:
* **Dual-Database Segregation (ADR-0006):** Strict boundary between the control plane database (`controlDb` — managing rules, channels, memberships, and billing) and the time-series telemetry store (`logDb` — managing high-volume events, rollups, outboxes, and delivery attempts).
* **4-Tier Evaluation Engine:** Fast-path instant evaluation ($\le 1\text{s}$), 1-minute windowed rollup evaluation ($\approx 5\text{s}$), operational health checks ($\approx 30\text{s}$), and AI/spend signals ($\approx 300\text{s}$).
* **PostgreSQL-Backed Queue Infrastructure:** Powered by `pg-boss` (v12) with dedicated queue partitions per provider (`connector.v2.{slack|discord|teams|pagerduty|email|sms|webhook}`), job priorities, circuit breaking, sliding-window rate limiting, and dead-letter handling.
* **Fail-Closed Entitlement Restrictions:** Automatic degradation to `EMAIL_ONLY_RESTRICTED` routing to verified project owners when subscription tiers lapse or third-party channels are unavailable.

---

## 1. Alerting Module Inventory

### Key Files & Components
* **Rule Definitions & Schemas:**
  * [rules.types.ts](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/rules/rules.types.ts) — Zod schemas for conditions (`threshold`, `change`, `anomaly`, `static`, `composite`) and actions.
  * [rules.service.ts](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/rules/rules.service.ts) — Rule CRUD, quota assertions, template cloning, and rule testing.
  * [rules.repository.ts](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/rules/rules.repository.ts) — Control plane persistence for alert rules, conditions, actions, and revisions.
* **Evaluation Engines:**
  * [engines.ts](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/runtime/engines.ts) — `AlertRuntimeEngines` executing Fast, Window, Operational, and AI evaluations.
  * [rule-catalog.ts](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/runtime/rule-catalog.ts) — In-memory caching and compilation of active alert rules.
  * [presets.ts](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/evaluator/presets.ts) — 28 platform-managed default alert presets.
* **Decision & State Machine:**
  * [decision.engine.ts](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/decision/decision.engine.ts) — State transitions (`inactive` $\rightarrow$ `firing` $\rightarrow$ `acknowledged` $\rightarrow$ `resolved`), fingerprint hashing, cooldown checks, and row locking.
* **Routing & Entitlements:**
  * [notification-router.ts](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/runtime/notification-router.ts) — Router worker processing `alert.notification-router`.
  * [notification-routing.service.ts](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/runtime/notification-routing.service.ts) — Priority matching across silences, channel bindings, and project routes.
  * [notification-entitlement.service.ts](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/runtime/notification-entitlement.service.ts) — Entitlement checking and downgrade enforcement.
  * [email-only-restricted-routing.ts](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/runtime/email-only-restricted-routing.ts) — Direct resolution of active verified project owner email.
* **Workers & Outbox:**
  * [queue.ts](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/queue.ts) — `registerAlertingWorkers()` bootstrap and timer loops.
  * [telemetry-outbox-relay.ts](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/runtime/telemetry-outbox-relay.ts) — Relay dequeuing `telemetry_outbox` into `alert.evaluate.fast`.
* **Connectors & Delivery:**
  * [delivery.service.ts](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/connectors/delivery/delivery.service.ts) — `NotificationDispatcher` with rate limiting, circuit breaker, and retry logic.
  * [secret.service.ts](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/connectors/secrets/secret.service.ts) — AES-256-GCM encryption/decryption for credentials.
  * `src/modules/connectors/providers/` — Connector implementations: `slack`, `discord`, `teams`, `pagerduty`, `email`, `sms`, `webhook`.

---

## 2. Alert Rule Audit

### 4-Tier Execution Taxonomy

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       4-TIER EVALUATION TOPOLOGY                                       │
├─────────────────────────┬─────────────────────────┬─────────────────────────┬──────────────────────────┤
│ Tier 1: Fast / Instant  │ Tier 2: Windowed Metric │ Tier 3: Operational     │ Tier 4: AI & Spend       │
│ Frequency: ~1 second    │ Frequency: ~5 seconds   │ Frequency: ~30 seconds  │ Frequency: ~300 seconds  │
│ Source: Outbox / Stream │ Source: 1m Metrics / DB │ Source: System Health   │ Source: AI Metrics / Log │
└─────────────────────────┴─────────────────────────┴─────────────────────────┴──────────────────────────┘
```

| Tier | Category | Preset Keys | Input Data Source | Trigger Mechanism | Evaluation Cost |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Tier 1** | Ingestion-Driven / Fast-Path | `unhandled_exception_fast`, `fatal_exception_fast`, `process_crash_fast`, `out_of_memory_fast`, `cron_failed_fast`, `security_event_fast`, `auth_failure_fast`, `heartbeat_lost_fast`, `deployment_failed_fast`, `connector_open_circuit_fast` | Raw telemetry events in `events_*` | `telemetry_outbox` inserted in event transaction $\rightarrow$ `alert.evaluate.fast` | $\mathcal{O}(N)$ in-memory match against cached rule catalog |
| **Tier 2** | Analytics-Driven / Windowed | `high_error_rate`, `high_latency_p95`, `elevated_5xx`, `failed_cron`, `availability_degradation`, `traffic_spike`, `log_error_burst`, `error_volume_spike`, `high_latency_p99`, `cron_failure_rate` | `request_metrics_1m`, `cron_metrics_1m`, `analytics_watermarks` | Scheduled timer $\rightarrow$ `alert.evaluate.window` | Indexed range scans on 1m rollup tables |
| **Tier 3** | Scheduled / Operational | `service_inactivity`, `request_inactivity`, `out_of_memory_logs`, `database_connection_logs`, `high_cpu_usage`, `high_memory_usage`, `queue_backlog`, `db_connection_errors`, `service_health_degradation`, `endpoint_health_degradation` | Synthetic health checks, queue stats, log patterns | Scheduled timer $\rightarrow$ `alert.evaluate.operational` | Targeted aggregation queries across 5–15m windows |
| **Tier 4** | Worker-Driven / AI | `ai_failed_requests`, `ai_slow_requests_p95`, `ai_failure_rate`, `ai_credit_burn_spike`, `ai_cost_spike` | `ai_metrics_1m`, `ai_requests` | Scheduled timer $\rightarrow$ `alert.evaluate.ai` | Compact aggregation on AI usage tables |

---

## 3. Ingestion Audit

```
┌─────────────────┐       ┌───────────────────────────────┐       ┌──────────────────────────┐
│ Ingestion Route │ ────► │ Batch Normalizer & Validation │ ────► │ TelemetryWriter (Log DB) │
└─────────────────┘       └───────────────────────────────┘       └─────────────┬────────────┘
                                                                                │
                                                                    BEGIN SINGLE TRANSACTION
                                                                                │
                                                                  ┌─────────────┴────────────┐
                                                                  ▼                          ▼
                                                        ┌───────────────────┐      ┌───────────────────┐
                                                        │  events_* Tables  │      │ telemetry_outbox  │
                                                        └───────────────────┘      └───────────────────┘
                                                                                             │
                                                                                    COMMIT TRANSACTION
                                                                                             │
                                                                                             ▼
                                                                                   [TelemetryOutboxRelay]
                                                                                             │
                                                                                             ▼
                                                                                    (alert.evaluate.fast)
```

### Ingestion Pipeline Analysis
1. **Synchronous Boundaries:**
   * Ingestion routes ([ingestion/routes.ts](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/ingestion/routes.ts)) perform only schema validation, cached API key verification, quota pre-checks, and dispatch to `TelemetryWriter`.
   * Ingestion **never** performs synchronous alert rule evaluation, connector queries, or external network requests.
2. **Transactional Outbox Guarantee:**
   * When errors or fast-path signals are detected, [telemetry-writer.ts](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/ingestion/pipeline/telemetry-writer.ts) writes both the event record and the corresponding `telemetry_outbox` row inside the **same atomic database transaction**.
   * If the write fails, both roll back cleanly. If it succeeds, `TelemetryOutboxRelay` picks up the outbox row within 1 second.
3. **Noisy Neighbor Protection:**
   * Fast evaluation jobs use `singletonKey: alert-fast:{orgId}:{projectId}:{hash}` with a 60-second TTL to coalesce bursts of identical errors from high-throughput tenants.

---

## 4. Analytics Audit

### Analytics $\rightarrow$ Alerting Lifecycle
* **Rollup Generation:** Background workers in `pulse/src/modules/analytics-engine/` aggregate raw events into 1-minute metrics (`request_metrics_1m`, `cron_metrics_1m`, `ai_metrics_1m`).
* **Watermark Tracking:** [watermark.repository.ts](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/analytics/watermark.repository.ts) advances monotonic high-water marks in `analytics_watermarks`.
* **Window Evaluation:** `AlertRuntimeEngines.evaluateWindow()` queries 1-minute buckets over lookback intervals (5 to 15 minutes) with bounded `LIMIT` and indexed `bucket` timestamps.
* **Late-Arriving Events:** Handled gracefully because queries evaluate time ranges (`bucket >= NOW() - INTERVAL 'X minutes'`) rather than single instantaneous points.

---

## 5. Alert Lifecycle Audit

### State Machine Transition Model

```
       ┌─────────────────┐
       │   [ INACTIVE ]  │ ◄─────────────────────────────────────────────┐
       └────────┬────────┘                                               │
                │ Condition Breach                                       │
                ▼                                                        │
       ┌─────────────────┐       Acknowledge       ┌───────────────────┐ │
  ┌──► │   [ FIRING ]    │ ──────────────────────► │ [ ACKNOWLEDGED ]  │ │
  │    └────────┬────────┘                         └─────────┬─────────┘ │
  │             │                                            │           │
  │ Breach Loop │ Auto-Resolve / Metric Normal               │           │
  │ (Cooldown)  ▼                                            │           │
  │    ┌─────────────────┐                                   │           │
  └─── │  [ RESOLVED ]   │ ◄─────────────────────────────────┘           │
       └────────┬────────┘                                               │
                │ Silence / Reset                                        │
                └────────────────────────────────────────────────────────┘
```

### State Management & Concurrency Controls
* **Row-Level Locking:** [decision.engine.ts](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/decision/decision.engine.ts) uses `SELECT ... FOR UPDATE` on `alert_rule_eval_states` to serialize state updates for the same rule and project across concurrent workers.
* **Stable Fingerprinting:** Fingerprints are deterministically computed as `sha256(ruleId:orgId:projectId:environment:entityId)`.
* **State Transition Behavior:**
  * `false → true`: Creates `alert_events_v2` (`status: firing`), appends transition history in `alert_event_history_v2`, and generates a `notification_job`.
  * `true → true`: If already `firing`, suppresses duplicate notifications unless the configured `cooldown_seconds` has elapsed.
  * `true → false`: Sets status to `resolved`, clears breach counters, and queues a resolution notification.

---

## 6. Subscription & Entitlement Audit

### Entitlement Architecture

```
                       ┌───────────────────────────────────┐
                       │ Alert Evaluation / Routing Worker │
                       └─────────────────┬─────────────────┘
                                         │
                                         ▼
                      [ NotificationEntitlementService ]
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   ▼                                           ▼
       Plan: Free / Unsubscribed                   Plan: Pro / Enterprise
                   │                                           │
                   ▼                                           ▼
       [ EMAIL_ONLY_RESTRICTED ]                     [ FULL_CONNECTOR_ACCESS ]
                   │                                           │
                   ▼                                           ▼
        Only Verified Project Owner                 Slack, Discord, PagerDuty,
          (Managed Email Worker)                      Teams, Webhooks, SMS
```

* **Creation Time:** Enforced via [quota-guard.ts](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/billing/entitlements/quota-guard.ts) asserting `alerting.enabled` and `quota.alert_rules`.
* **Routing Time:** `AlertNotificationRouter` dynamically queries project subscription status. If a project is on the Free tier or expired, it enforces `EMAIL_ONLY_RESTRICTED`, dispatching strictly to the verified project owner's email address and suppressing third-party connectors.

---

## 7. Routing Audit

### Routing Resolution Precedence in [notification-routing.service.ts](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/runtime/notification-routing.service.ts)
1. **Silences Check:** Active silence matching event labels/environment immediately sets `status: 'suppressed'`.
2. **Rule Action Bindings:** Specific connector/channel actions attached to the alert rule.
3. **Project Routes:** Default connector mappings defined in `connector_routes` filtered by severity and environment.
4. **Fallback Mode:** In-app notification creation with email fallback to project owner.

---

## 8. Connector Module Audit

### Supported Provider Implementations

```
                               ┌────────────────────────────────┐
                               │  NotificationDispatcher (V2)   │
                               └───────────────┬────────────────┘
                                               │
               ┌───────────────┬───────────────┼───────────────┬───────────────┐
               ▼               ▼               ▼               ▼               ▼
          ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
          │  Slack  │     │ Discord │     │  Teams  │     │PagerDuty│     │ Webhook │ ...
          └─────────┘     └─────────┘     └─────────┘     └─────────┘     └─────────┘
```

| Provider | Transport / Protocol | Authentication | Formatting / Payload | Specific Features |
| :--- | :--- | :--- | :--- | :--- |
| **Slack** | HTTPS POST (`chat.postMessage` or Webhook) | Bot Token (`xoxb-`) or Webhook URL | Slack Block Kit (JSON) | Interactive buttons, thread support, severity color bars |
| **Discord** | HTTPS POST (`/api/webhooks/`) | Webhook URL & Token | Embeds Array | Hex color mapping, markdown fields, avatar customization |
| **Teams** | HTTPS POST (Webhook / Workflow) | Webhook URL | Adaptive Cards v1.4 / MessageCard | Fact sets, action buttons, open URI actions |
| **PagerDuty**| HTTPS POST (Events API v2) | Routing Key (32 hex) | Events API v2 JSON Envelope | `dedup_key` deduplication, severity mapping (`critical`, `error`, `warning`, `info`), custom details |
| **Email** | SMTP / SendGrid / SES | SMTP Credentials / API Key | HTML + Plaintext Template | Dual-format multipart MIME, unsubscribe headers |
| **SMS** | HTTPS POST (Twilio / MessageBird) | Account SID + Auth Token | Plaintext (160 char limit) | URL shortening, GSM-7 truncation |
| **Webhook** | HTTPS POST / PUT | HMAC Signing Secret / Custom Headers | Standard JSON Envelope | `X-Pulse-Signature` (HMAC-SHA256), custom header injection |

---

## 9. Worker Audit

### Dispatcher Architecture in [delivery.service.ts](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/connectors/delivery/delivery.service.ts)

Every outbound delivery passes through a 4-layer protection pipeline:

```
[ INCOMING NOTIFICATION ]
          │
          ▼
1. RATE LIMITER ──────────► (Exceeded) ──► Reschedule with Exponential Backoff
          │ (Allowed)
          ▼
2. CIRCUIT BREAKER ───────► (Open) ──────► Fast-fail & Reschedule Retry
          │ (Closed)
          ▼
3. TIMEOUT CONTROLLER ────► (AbortController, default 10s)
          │
          ▼
4. HTTP DISPATCH ─────────► [ Provider API ]
          │
          ├────────────────────────────────┬────────────────────────────────┐
          ▼                                ▼                                ▼
    [ 2xx Success ]                 [ 429 / 5xx / Timeout ]         [ 401 / 403 / 4xx ]
  Record metrics & audit         Retryable backoff (pg-boss)      Non-retryable Dead-Letter
```

* **Rate Limiting:** Sliding-window token bucket enforced per connector (`rate_limit_requests` per `rate_limit_window_seconds`).
* **Circuit Breaker:** Tracks consecutive failures per connector; transitions to `open` upon reaching `failure_threshold` (default: 5) to prevent worker starvation on dead third-party endpoints.
* **Failure Categorization:**
  * **Transient (Retryable):** `network_error`, `timeout`, `rate_limit`, `5xx`. Retried via exponential backoff ($T_{\text{delay}} = \text{base} \times \text{multiplier}^{\text{attempts}}$).
  * **Permanent (Non-Retryable):** `auth_error` (401/403), `invalid_config`, `invalid_payload` (400). Immediately routed to `connector_dead_letters`.

---

## 10. Queue Audit

### Queue Partitioning Topology

```
┌───────────────────────────────────────┬────────────────────────────────────────────────────────────────────────┐
│ Queue Name                            │ Purpose & Priority Handling                                            │
├───────────────────────────────────────┼────────────────────────────────────────────────────────────────────────┤
│ alert.telemetry-outbox-relay          │ Batched outbox scanner draining Log DB outbox into fast queue (1s tick)│
│ alert.evaluate.fast                   │ High-priority fast-path rule evaluation (< 1s latency)                 │
│ alert.evaluate.window                 │ 1-minute rollup metric rule evaluation (5s tick)                       │
│ alert.evaluate.operational            │ Operational health & synthetic rule evaluation (30s tick)              │
│ alert.evaluate.ai                     │ AI cost & token usage rule evaluation (300s tick)                      │
│ alert.notification-router             │ Resolves channel targets, silences, and entitlements                   │
│ alert.escalation-sweep                │ Evaluates unacknowledged incident escalation policies (10s tick)       │
│ connector.v2.slack                    │ Isolated worker pool for Slack deliveries                              │
│ connector.v2.discord                  │ Isolated worker pool for Discord deliveries                            │
│ connector.v2.teams                    │ Isolated worker pool for Microsoft Teams deliveries                    │
│ connector.v2.pagerduty                │ Isolated worker pool for PagerDuty deliveries                          │
│ connector.v2.email                    │ Isolated worker pool for transactional & managed emails                │
│ connector.v2.sms                      │ Isolated worker pool for SMS notifications                             │
│ connector.v2.webhook                  │ Isolated worker pool for generic Webhook deliveries                    │
└───────────────────────────────────────┴────────────────────────────────────────────────────────────────────────┘
```

* **Provider Isolation:** Dedicated worker queues prevent a slow or broken webhook endpoint from delaying critical PagerDuty or Slack notifications.
* **Severity Priority:** Mapped via `CONNECTOR_PRIORITY` (`critical = 1`, `error = 5`, `warning = 10`, `info = 20`), allowing critical incidents to preempt info alerts under heavy queue loads.

---

## 11. Reliability & Idempotency Audit

| Stage | Deduplication / Idempotency Key | Guarantee Level |
| :--- | :--- | :--- |
| **Ingestion $\rightarrow$ Outbox** | Compound key on `(namespace, organization_id, signal_kind:event_id)` in `alert_runtime_idempotency_keys` | Exactly-once persist |
| **Alert Evaluation** | Row lock on `(rule_id, entity_fingerprint)` in `alert_rule_eval_states` | Exactly-once state machine transition |
| **Notification Job Creation** | Coalesced fingerprint hashing per breach cycle | Deduplicated per cooldown window |
| **Routing Dispatch** | Singleton key per delivery in pg-boss | At-least-once queue lease with dedup guard |
| **Provider Delivery** | Upstream dedup key (e.g. PagerDuty `dedup_key`, Slack thread ts) | Effectively-once provider delivery |

---

## 12. Security Audit

1. **Secrets Encryption:** All connector configs and credentials are encrypted using **AES-256-GCM** via [secret.service.ts](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/connectors/secrets/secret.service.ts) with per-record random salt and IV.
2. **Tenant Isolation:** All database queries strictly enforce tenant scoping (`WHERE organization_id = $1 AND project_id = $2`).
3. **SSRF Posture:** The `automation` module enforces strict SSRF verification (`validateWebhookUrl()`), but `WebhookConnector` currently relies only on URL formatting validation without checking private IP ranges (documented in Finding P1-01).

---

## 13. Database Schema & Indexing Audit

### Dual-Database Architecture
* **Control DB:** Owns `alert_rules`, `alert_rule_conditions`, `alert_rule_actions`, `alert_rule_bindings`, `alert_channels`, `alert_silences`, `connector_configs`, `connector_credentials`, `connector_routes`.
* **Log DB:** Owns `telemetry_outbox`, `alert_events_v2`, `alert_event_history_v2`, `alert_rule_eval_states`, `notification_jobs`, `notification_delivery_attempts`, `connector_deliveries`, `connector_dead_letters`, `analytics_watermarks`.

### Indexing Patterns
* Extensive use of partial indexes filtering `WHERE deleted_at IS NULL` and `WHERE enabled = TRUE` optimizes query performance and maintains small index footprints.

---

## 14. Observability Audit

* **Structured Logging:** Fastify/Pino structured JSON logs record correlation IDs, `organizationId`, `projectId`, `ruleId`, `deliveryId`, and execution `latencyMs`.
* **Audit Trails:** Every configuration update, state change, and delivery attempt is immutably recorded in `connector_audit_logs` and `alert_event_history_v2`.
* **Metrics:** Delivery counts, failure rates, latencies, and circuit breaker health histories are tracked per connector.

---

## 15. Performance Audit

* **In-Memory Rule Catalog:** [AlertRuntimeRuleCatalog](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/alerting/runtime/rule-catalog.ts) caches active rules in memory and refreshes every 30 seconds, eliminating rule-fetching overhead during fast-path evaluations.
* **Active Tenant Discovery:** Queries compact `analytics_watermarks` and `*_metrics_1m` tables rather than scanning multi-million-row raw event tables.
* **Zero Synchronous Ingestion Overhead:** Ingestion latency is completely decoupled from alert rule count and connector complexity.

---

## 16. Failure Matrix

| Scenario | Current Behavior | Resilience Mechanism | Risk / Severity |
| :--- | :--- | :--- | :--- |
| **Duplicate Event Ingestion** | De-duplicated via ON CONFLICT on `event_id` | Database unique constraint | **None (Safe)** |
| **Worker Crash Before Request** | pg-boss visibility timeout expires; job re-claimed | At-least-once queue lease | **None (Safe)** |
| **Worker Crash After Request** | Delivery recorded on next attempt or deduplicated by provider | Provider dedup key / idempotent delivery | **Low** |
| **Provider Timeout (10s)** | AbortController triggers timeout; classified as retryable | Exponential backoff | **Low** |
| **Provider Returns HTTP 429** | Backoff delay extracted from `Retry-After` header | Sliding-window rate limit backoff | **Low** |
| **Provider Returns HTTP 5xx** | Classified as network failure; retry scheduled | Exponential backoff (max attempts: 3–5) | **Low** |
| **Provider Returns HTTP 401/403**| Classified as auth error; non-retryable | Transitions to `connector_dead_letters` | **Low** |
| **Connector Deleted While Queued**| Worker checks connector presence; drops job gracefully | Fail-closed guard | **None (Safe)** |
| **Rule Deleted While Queued** | Notification router detects deleted rule and aborts | Graceful cancellation | **None (Safe)** |
| **Subscription Downgraded** | Notification router enforces `EMAIL_ONLY_RESTRICTED` | Automatic owner email fallback | **None (Safe)** |
| **High-Volume Burst (100k info)**| Coalesced via singletonKey and queued per-provider | High-priority jobs (p=1) preempt low-priority | **None (Safe)** |

---

## 17. Ranked Findings

### [P0 — Critical] None
* No critical blockers, silent data drops, or unhandled crash loops exist in the active runtime pipeline.

---

### [P1 — High Priority]

#### P1-01: Unify SSRF Validation Across All Outbound Webhook Connectors
* **Component:** `pulse/src/modules/connectors/providers/webhook/webhook.connector.ts`
* **Finding:** While the `automation` module enforces strict SSRF checks (`validateWebhookUrl` in `src/modules/automation/ssrf.ts`), `WebhookConnector` validates only URL formatting (`z.string().url()`) without rejecting private RFC1918 or cloud metadata IP ranges (`169.254.169.254`).
* **Failure Scenario:** A tenant could specify an internal IP endpoint (e.g. `http://169.254.169.254/latest/meta-data/`) as a custom webhook destination.
* **Recommendation:** Import and invoke `validateWebhookUrl()` within `WebhookConnector.deliver()` and `WebhookConnector.testConnection()`.

---

### [P2 — Medium Priority]

#### P2-01: Deprecation and Migration of Legacy Alerting V1 Tables
* **Component:** `pulse/src/db/postgres/canonical_migrations_draft/08_alerting/`
* **Finding:** Both legacy V1 schemas (`alert_events`, `alert_delivery_attempts`) and canonical V2 schemas (`alert_events_v2`, `notification_jobs`, `connector_deliveries`) exist in the migration scripts.
* **Recommendation:** Establish a formal deprecation and cleanup migration to drop legacy V1 tables once historical retention windows elapse.

---

### [P3 — Low Priority]

#### P3-01: Standardize W3C Distributed Tracing Propagation Across Worker Queues
* **Component:** `pulse/src/modules/connectors/queue.ts`
* **Finding:** Job payloads pass correlation IDs as strings but do not serialize OpenTelemetry `traceparent` headers across pg-boss queue boundaries.
* **Recommendation:** Inject OpenTelemetry W3C trace context into pg-boss job headers to enable unbroken distributed tracing across workers.

---

## 18. Architectural Strengths

1. **Strict ADR-0006 Multi-Database Isolation:** Clean physical and logical separation between control-plane and telemetry-plane database pools.
2. **Atomic Ingestion Outbox:** Zero lost alert signals during ingestion crashes due to transactional outbox coupling.
3. **Provider-Isolated Worker Queues:** Dedicated queue per connector provider prevents cascade failures from third-party outages.
4. **Resilient Downgrade Handling:** Automated, fail-safe fallback to verified project owner email when subscriptions expire or third-party connectors fail.
5. **Robust Cryptographic Security:** AES-256-GCM encryption with per-record salt/IV and authentication tags for all credentials.

---

## 19. Architectural Weaknesses

1. **Localized SSRF Validation:** SSRF checks exist in the automation module rather than being centralized in the core HTTP client.
2. **Dual Schema Coexistence:** Legacy V1 tables and V2 tables exist side-by-side in migration scripts.

---

## 20. Recommended Target Architecture

```
                                    ┌───────────────────────┐
                                    │    Client SDK / App   │
                                    └───────────┬───────────┘
                                                │
                                    HTTP Ingest │ (Synchronous, fast validation)
                                                ▼
                                    ┌───────────────────────┐
                                    │   Ingestion Service   │
                                    └───────────┬───────────┘
                                                │
                              ┌─────────────────┴─────────────────┐
                              │ Atomic Single Postgres Write      │
                              ▼                                   ▼
                   ┌────────────────────┐               ┌────────────────────┐
                   │  Raw Events Tables │               │  telemetry_outbox  │
                   └──────────┬─────────┘               └─────────┬──────────┘
                              │                                   │
                     Rollup   │                                   │ Dequeued by Outbox Relay
                    Workers   │                                   │ (Every 1s)
                              ▼                                   ▼
                   ┌────────────────────┐               ┌────────────────────┐
                   │ *_metrics_1m / DB  │               │ alert.evaluate.fast│
                   └──────────┬─────────┘               └─────────┬──────────┘
                              │                                   │
                 Scheduled    │ Window / Ops / AI                 │
                 Worker Ticks │ (5s / 30s / 300s)                 │
                              ▼                                   │
                   ┌──────────────────────────────────────────────┴──────────┐
                   │            AlertRuntimeEngines (Evaluation)             │
                   └────────────────────────────┬────────────────────────────┘
                                                │
                                                ▼
                   ┌─────────────────────────────────────────────────────────┐
                   │             AlertDecisionEngine (Lock & Dedup)          │
                   │           (alert_events_v2 & notification_jobs)         │
                   └────────────────────────────┬────────────────────────────┘
                                                │
                                                ▼
                   ┌─────────────────────────────────────────────────────────┐
                   │      alert.notification-router (Routing & Silencing)    │
                   └────────────────────────────┬────────────────────────────┘
                                                │
                 Enqueued to Provider-Isolated  │ Prioritized Queues
                                                ▼
                   ┌─────────────────────────────────────────────────────────┐
                   │  connector.v2.{slack|discord|teams|pagerduty|email|...} │
                   └────────────────────────────┬────────────────────────────┘
                                                │
                                                ▼
                   ┌─────────────────────────────────────────────────────────┐
                   │    NotificationDispatcher (Rate Limit, Circuit, SSRF)   │
                   └────────────────────────────┬────────────────────────────┘
                                                │
                                                ▼
                                   ┌─────────────────────────┐
                                   │ External Provider APIs  │
                                   └─────────────────────────┘
```

---

## 21. Recommended Change Plan

1. **Phase 1 (Security & SSRF):**
   * Move `validateWebhookUrl()` into `src/modules/connectors/shared/http.ts` and apply to all outbound Webhook and Slack/Discord/Teams webhook dispatches.
2. **Phase 2 (Schema Cleanup):**
   * Generate migration script to retire legacy V1 alerting tables (`alert_events`, `alert_delivery_attempts`) once backfill retention completes.
3. **Phase 3 (Observability):**
   * Inject OpenTelemetry `traceparent` headers into pg-boss job envelopes for seamless end-to-end distributed trace propagation.

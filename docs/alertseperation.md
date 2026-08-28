## Objective

Deeply analyze the entire backend codebase and identify **every worker, queue, job, processor, scheduler, and supporting service that is actually responsible for delivering alerts/notifications to users**.

The immediate goal is to create a dedicated development command:

`npm run dev:alert:workers`

This command must start **only the workers required for alert delivery**, without starting unrelated workers such as billing, ingestion, analytics, maintenance, AI processing, etc.

Do not assume worker names, queue names, or architecture. Derive everything from the actual codebase.

---

# Phase 1 — Map the Complete Alerting Flow

First inspect the backend architecture and trace alerting end-to-end.

Start by locating:

* Alert-related controllers/routes
* Alert configuration
* Alert rules
* Alert services
* Alert repositories
* Notification services
* Connector services
* Email services
* Webhook services
* Slack/Discord/Teams/PagerDuty/etc. integrations
* Notification queues
* Connector queues
* Worker implementations
* Job processors
* Job producers/publishers
* Retry mechanisms
* Dead-letter handling
* Scheduling/cron jobs
* Alert evaluation workers
* Event-to-alert pipelines
* Notification batching
* Notification deduplication
* Notification throttling
* Notification preference checks
* User/org/project notification configuration

Search the entire repository rather than only obvious `worker` directories.

Search for concepts such as:

* `alert`
* `notification`
* `connector`
* `email`
* `send`
* `dispatch`
* `queue`
* `worker`
* `job`
* `publish`
* `enqueue`
* `process`
* `consumer`
* `pg-boss`
* `bull`
* `cron`
* `scheduler`
* `webhook`
* `slack`
* `discord`
* `teams`
* `pagerduty`

Also inspect package scripts, worker bootstrap files, application entrypoints, Docker/compose files, and environment configuration.

---

# Phase 2 — Build the Real Alert Delivery Graph

Construct the actual flow from source code.

For example, determine whether the real architecture resembles:

```text
Incoming Event
    ↓
Alert Evaluation
    ↓
Alert Trigger
    ↓
Notification Creation
    ↓
Notification Queue
    ↓
Connector Queue
    ↓
Provider Worker
    ↓
Email / Slack / Discord / Webhook / etc.
    ↓
User
```

But DO NOT assume this structure.

Determine the real architecture from the code.

For every stage identify:

1. File
2. Module
3. Service
4. Queue name
5. Job name
6. Worker name
7. Producer
8. Consumer
9. Retry behavior
10. Dependencies
11. Whether the component is actually required for alert delivery

Clearly distinguish:

### Alert-generation workers

Workers that determine whether an alert should be triggered.

### Alert-dispatch workers

Workers that take a triggered alert and prepare/send notifications.

### Connector workers

Workers that actually deliver notifications through external providers.

### Supporting workers

Workers that may indirectly participate in alert delivery.

### Unrelated workers

Workers that have nothing to do with alert delivery.

---

# Phase 3 — Trace Email Delivery Separately

Email must be analyzed independently.

Find the complete path for:

```text
Alert
→ Notification
→ Email job
→ Email queue
→ Email worker
→ Email provider
→ User
```

Determine exactly:

* Which service creates the email job
* Which queue receives it
* Which worker consumes it
* Whether a generic notification worker is involved
* Whether email has a dedicated worker
* Whether email shares a connector worker
* Which provider/service is used
* How retries work
* Whether failed emails enter another queue
* Whether dead-letter processing is required

Do not classify a worker as required merely because it imports an email module. Prove that it participates in the runtime execution path.

---

# Phase 4 — Trace Connector Delivery Separately

Analyze every connector implementation.

At minimum inspect whatever exists in the codebase for:

* Slack
* Discord
* Microsoft Teams
* PagerDuty
* Webhook
* Email
* SMS
* Other connectors

For each connector determine:

```text
Alert
→ Notification/Dispatch
→ Queue
→ Job
→ Worker
→ Connector Provider
→ External Destination
```

Record:

* queue name
* job name
* producer
* worker
* worker entrypoint
* provider implementation
* retry worker
* dead-letter worker
* required supporting services

Determine whether the current architecture uses:

* one generic connector worker
* provider-specific workers
* dynamically named queues
* multiple queues
* priority-based jobs
* a shared dispatcher
* dedicated workers per connector type

Again, use the code as the source of truth.

---

# Phase 5 — Analyze Worker Bootstrap Architecture

Find exactly how workers are currently started.

Inspect:

* `package.json`
* npm scripts
* worker entrypoints
* worker registry
* worker manager
* worker bootstrap
* process manager configuration
* Docker configuration
* development scripts
* production worker startup
* PM2 configuration if present
* environment variables controlling workers

Determine whether there is currently:

```text
npm run dev
```

or another command that starts all workers together.

Identify how individual workers can technically be started.

Do not duplicate worker initialization logic if the project already has a worker registry/bootstrap system.

---

# Phase 6 — Define the Minimal Alert Worker Set

After tracing the complete runtime flow, create a definitive classification.

Use a table similar to:

| Worker | Queue                | Purpose               | Alert Required? | Why       |
| ------ | -------------------- | --------------------- | --------------- | --------- |
| X      | queue-x              | Billing               | NO              | Unrelated |
| Y      | alert-evaluation     | Evaluates alert rules | YES             | Required  |
| Z      | connector-send-slack | Sends Slack alerts    | YES             | Required  |
| A      | connector-send-email | Sends email alerts    | YES             | Required  |

The classification must be based on actual call/queue relationships.

The goal is:

> Start the smallest possible set of workers that allows alert testing to work end-to-end.

Do not start every worker simply because it is "probably useful."

---

# Phase 7 — Check Hidden Dependencies

Before creating the command, verify whether alert workers depend on any other worker.

Examples:

* alert evaluation depends on an event processing worker
* notification creation depends on another queue
* connector jobs depend on a generic dispatcher
* email delivery depends on a notification worker
* retry processing depends on a shared worker
* scheduled alerts depend on a scheduler
* alert aggregation depends on another processor

If such dependencies exist, include them **only if they are genuinely required for the alert flow**.

Document why each dependency is included.

---

# Phase 8 — Implement `dev:alert:workers`

Create:

```bash
npm run dev:alert:workers
```

The command must:

1. Start only alert-related workers.
2. Start all workers required for an end-to-end alert test.
3. Avoid unrelated workers.
4. Reuse existing worker initialization code wherever possible.
5. Preserve existing production worker behavior.
6. Avoid creating duplicate queue consumers.
7. Fail clearly if a required worker cannot start.
8. Handle graceful shutdown correctly.
9. Forward SIGINT/SIGTERM correctly.
10. Make worker startup logs obvious.

Example conceptual output:

```text
[alert-workers] Starting alert worker group...

[alert-workers] ✓ alert-evaluation-worker
[alert-workers] ✓ notification-worker
[alert-workers] ✓ connector-send-email-worker
[alert-workers] ✓ connector-send-slack-worker

[alert-workers] Alert worker group ready.
```

Do not copy/paste large portions of existing worker bootstrap code if the repository already provides reusable worker registration.

Prefer a worker registry such as:

```ts
const alertWorkers = [
  ...
];
```

or an existing equivalent architecture.

---

# Phase 9 — Do NOT Break Existing Commands

Existing commands such as:

```bash
npm run dev
npm run dev:workers
npm run start
```

must continue behaving exactly as before unless a change is genuinely necessary.

Do not remove existing workers.

Do not change production worker behavior merely to support this development command.

Do not rename existing queues.

Do not change queue semantics.

Do not change retry configuration.

Do not change alert behavior.

The new command should provide an isolated development/testing entrypoint.

---

# Phase 10 — Validate the Implementation

After implementation, verify:

### Static verification

* Every worker referenced by `dev:alert:workers` exists.
* Every queue exists.
* Every job exists.
* Every worker has a real consumer/processor.
* No unrelated workers are started.
* No duplicate worker registrations exist.

### Runtime verification

Start:

```bash
npm run dev:alert:workers
```

Confirm:

* expected workers start
* unrelated workers do not start
* queues connect successfully
* workers subscribe successfully
* shutdown works correctly

Then trace a test alert through the system.

Verify:

```text
Alert trigger
    ↓
Job creation
    ↓
Queue
    ↓
Worker
    ↓
Connector
    ↓
External delivery
```

For email specifically verify:

```text
Alert
→ Email job
→ Email queue
→ Email worker
→ Provider
→ Delivery
```

For connectors verify the equivalent flow for each supported connector.

---

# Phase 11 — Test Isolation

The purpose of this command is testing.

Therefore verify that running:

```bash
npm run dev:alert:workers
```

does NOT accidentally start:

* billing workers
* usage workers
* analytics workers
* ingestion workers
* AI workers
* maintenance workers
* migration workers
* cleanup workers
* unrelated scheduled jobs
* unrelated connector processing

unless the code proves that a specific worker is required by alert delivery.

---

# Phase 12 — Final Report

After implementation provide a concise report containing:

## 1. Alert Architecture

Show the actual alert flow discovered in the repository.

## 2. Alert Workers

List every worker required for alert testing.

## 3. Email Flow

Show the exact email delivery path.

## 4. Connector Flow

Show the exact connector delivery path.

## 5. Worker Dependencies

Explain any non-obvious dependencies.

## 6. New Command

Confirm:

```bash
npm run dev:alert:workers
```

and explain exactly what it starts.

## 7. Workers Excluded

List major workers intentionally excluded and why.

## 8. Files Changed

List every modified/created file.

## 9. Validation

Report what was actually tested and whether the alert worker group starts successfully.

---

# Critical Rules

### Rule 1 — Do not guess

Never assume a worker is responsible for alerts based only on its filename.

Trace its producer → queue → consumer → execution path.

### Rule 2 — Do not over-start workers

The objective is isolation.

If an alert can work without a worker, do not start it.

### Rule 3 — Do not break production

The new development command must be additive unless a refactor is required for safe reuse.

### Rule 4 — Reuse existing architecture

If the project already has a worker registry, worker factory, bootstrap mechanism, or worker manager, extend it instead of creating a parallel architecture.

### Rule 5 — No fake testing

Do not create dummy workers or pretend a worker is required.

Use real queues, real jobs, and real worker implementations.

### Rule 6 — Find the complete flow first

Do not modify `package.json` immediately.

First understand the entire alerting architecture.

### Rule 7 — Check both directions

Trace:

```text
Alert → Worker
```

and also:

```text
Worker → Queue → Producer → Alert flow
```

This prevents accidentally including workers that merely share infrastructure.

### Rule 8 — Preserve existing queue semantics

Do not modify queue names, priorities, retry behavior, leases, or delivery semantics just to make the development command easier.

### Rule 9 — Check concurrency and duplicate consumers

Running the alert-only worker command must not accidentally create multiple consumers for the same queue unless that is explicitly supported by the architecture.

### Rule 10 — Make the result production-quality

The goal is not merely:

```json
"dev:alert:workers": "..."
```

The goal is a clean, maintainable worker isolation mechanism that can later support additional worker groups such as:

```bash
npm run dev:alert:workers
npm run dev:billing:workers
npm run dev:ingestion:workers
```

without duplicating the worker architecture.

---

# Implementation Report

## 1. Alert Architecture

The active runtime path discovered in the repository is:

```text
telemetry_outbox / connector-failure signal
    -> alert.telemetry-outbox-relay or alert.error-group-regressed
    -> alert.evaluate.fast
    -> AlertRuntimeEngines.evaluateFast()

scheduled telemetry/rollup evaluation
    -> alert.evaluate.window / alert.evaluate.operational / alert.evaluate.ai
    -> AlertRuntimeEngines.evaluateTier()

AlertRuntimeEngines
    -> rule catalog + effective policy resolution
    -> evaluator state, consecutive-breach, cooldown, and recovery checks
    -> AlertDecisionEngine.decide()
    -> alert_events_v2 + alert_event_state + alert_event_history_v2
    -> alert_notification_jobs + alert_notification_ledger
    -> alert.notification-router

AlertNotificationRouter
    -> in_app: marks the notification sent in Log DB
    -> managed email: connector.v2.email
    -> connector-backed alert: connector.v2.<provider>

connector transport worker
    -> entitlement and tenant checks
    -> ConnectorRepository
    -> NotificationDispatcher
    -> registered provider connector
    -> external provider destination
    -> delivery status, attempts, circuit state, retry, or dead letter

connector-delivery-retry
    -> ConnectorMonitor.processRetries()
    -> NotificationDispatcher.processRetry()
    -> provider delivery
```

The legacy `alert.form-batches` and `alert.process-batch` references are disconnected legacy documentation/comments. `src/shared/workers/alerting.processor.ts` is a placeholder and is not an active consumer. `alert.correlate` and `notification.digest` are published by escalation code but have no registered consumers.

## 2. Alert Workers

The alert-only group registers these real consumers:

| Queue | Worker purpose | Required |
| --- | --- | --- |
| `alert.telemetry-outbox-relay` | Claims durable telemetry outbox rows and publishes fast evaluation jobs | Yes |
| `alert.error-group-regressed` | Converts error-group regression signals into fast evaluation | Yes |
| `alert.evaluate.fast` | Evaluates event-driven alert rules | Yes |
| `alert.evaluate.window` | Evaluates window-tier rules from existing rollups | Yes |
| `alert.evaluate.operational` | Evaluates operational-tier rules from existing rollups | Yes |
| `alert.evaluate.ai` | Evaluates AI/capacity-tier rules from existing rollups | Yes |
| `alert.notification-router` | Claims notification jobs and dispatches transport jobs | Yes |
| `alert.escalation-sweep` | Advances due legacy escalation steps | Yes |
| `alert.escalate` | Runs snapshot escalation when `ESCALATION_V2=true` | Yes |
| `connector.v2.<provider>` | Canonical (and only) provider transport, including managed email | Yes |
| `connector-delivery-retry` | Replays retryable connector delivery rows | Yes |

Providers are sourced from the runtime registry: email, Slack, Discord, Microsoft Teams, PagerDuty, webhook, and SMS. Runtime dispatch timers produce the periodic evaluator, router, and outbox jobs. The circuit-probe timer remains active because it supports connector delivery recovery.

## 3. Email Flow

Managed alert email follows:

```text
AlertDecisionEngine.decide()
    -> alert_notification_jobs(channel_kind=email, connector_id=NULL)
    -> alert.notification-router
    -> connector.v2.email
    -> processManagedEmailJob()
    -> entitlement and verified owner/fallback checks
    -> sendEmail()
    -> configured SMTP provider
    -> alert delivery status and attempt record
```

Connector-backed email follows the same router boundary but enters `NotificationDispatcher`, which creates the registered `EmailConnector` and calls Nodemailer/SMTP. Auth and organization email polling workers are not involved in alert email delivery.

Transient managed-email failures are rethrown for pg-boss retry; permanent recipient/SMTP syntax-style failures are recorded as failed. Connector provider failures use the existing delivery retry and dead-letter state machine.

## 4. Connector Flow

For each registered provider:

```text
Alert notification job
    -> alert.notification-router
    -> connector.v2.<provider> (canonical, and the only transport)
    -> registerConnectorWorkers() provider consumer
    -> entitlement and tenant-scoped connector lookup
    -> NotificationDispatcher.dispatch()
    -> createConnector(provider)
    -> provider implementation
    -> external destination
```

Provider implementations are `EmailConnector`, `SlackConnector`, `DiscordConnector`, `TeamsConnector`, `PagerDutyConnector`, `WebhookConnector`, and `SmsConnector`. Delivery results are recorded in the V2 alert/connector runtime tables. Retryable delivery rows are handled by `connector-delivery-retry`; exhausted or permanent failures enter connector dead-letter state. Manual `connector-dead-letter-retry` is intentionally not required for automatic alert delivery.

## 5. Worker Dependencies

- Primary Postgres: alert configuration, connector configuration/credentials, routing, entitlements, and connector guard state.
- Log DB primary pool: telemetry, alert runtime state, notification jobs, delivery attempts, and dead letters.
- pg-boss: durable queues, scheduled jobs, locking, and job retry behavior.
- Alert configuration/routing services: effective rules, silences, channels, recipients, and entitlements.
- Connector registry/dispatcher: provider construction, transport, rate limits, circuit breakers, and delivery persistence.
- Ingestion workers are upstream producers of telemetry/outbox rows, not alert consumers.
- Analytics workers are upstream producers of rollups for slower tiers, not notification consumers. Existing rollups or a separately run analytics process are needed for those inputs.

## 6. New Command

```bash
npm run dev:alert:workers
```

This starts `src/shared/workers/alert-workers-main.ts`, which starts pg-boss, runs database ownership assertions, registers the alert-delivery mode of the alerting and connector registrars, logs an explicit `[alert-workers] Alert worker group ready` message, and forwards SIGINT/SIGTERM into idempotent graceful shutdown. The production/default `dev:workers` and `start:workers` paths still use the full worker registrations.

The additive production entrypoint is also available as:

```bash
npm run start:alert:workers
```

## 7. Workers Excluded

The alert-only command does not register:

- `alert.cleanup` or its daily retention schedule.
- `connector-health-check`, `connector-test`, `connector-secret-rotation`, `connector-oauth-refresh`, `connector-cleanup`, or `connector-dead-letter-retry`.
- Ingestion, analytics, billing, auth automation, AI reliability, automation, organization cleanup, user export, telemetry maintenance, or auth/org email polling workers.

These are excluded because they do not consume an alert delivery queue. Ingestion and analytics can be run separately when a test requires fresh telemetry or newly materialized rollups.

## 8. Files Changed

- `package.json`
- `src/modules/alerting/queue.ts`
- `src/modules/connectors/queue.ts`
- `src/modules/connectors/workers.ts`
- `src/shared/workers/alert-workers-main.ts`
- `test/unit/modules/connector-queue.test.ts`
- `test/unit/alert-worker-topology.test.ts`
- `test/unit/alert-worker-bootstrap.test.ts`
- `docs/alertseperation.md`

## 9. Validation

Passed:

- `npm run build`
- targeted IDE diagnostics for all changed TypeScript files
- `npx vitest run test/unit/alert-worker-topology.test.ts test/unit/alert-worker-bootstrap.test.ts test/unit/modules/connector-queue.test.ts` — 7 tests passed
- `npx vitest run test/unit/alerting-worker-hardening.test.ts test/unit/alerting-runtime-routing.test.ts test/unit/alerting-decision-engine.test.ts test/unit/notification-entitlement-routing.test.ts test/unit/telemetry-writer-outbox.test.ts` — 24 tests passed
- `npx tsx scripts/verify-alerting-runtime.ts --assert` — all database/runtime gates passed
- direct `npx tsx src/shared/workers/alert-workers-main.ts` smoke test — primary and Log DB connected, pool assertions passed, pg-boss started, alert-only registrars completed, and `[alert-workers] Alert worker group ready` was logged
- no tracked shell/monitor process remains after smoke testing

`npm run lint` could not run because the repository checkout does not contain an `eslint` executable. The full `npx vitest run` sweep was attempted but did not complete cleanly: it exposed an ADR pool-boundary failure in unchanged runtime files, failures in unrelated migration/analytics/auth/SDK areas, and a connector-queue timeout under full-suite load; the focused alert/connector suites passed independently. No pre-change full-suite baseline was available, so those unrelated failures are reported without labeling them as regressions. No real external-provider delivery was claimed; SMTP/provider credentials and a generated test alert were not exercised in this validation run.

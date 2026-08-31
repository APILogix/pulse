# 24 — Action Inventory and Implement/Remove Decisions

Evidence basis: full read of `src/modules/automation/action-runner.ts`, `types.ts` (`ACTION_TYPES`, `DANGEROUS_ACTIONS`), `entitlements.ts` (`ACTION_FEATURE_MAP`), plus a live read-only survey of the PRIMARY database for backing entities (`scripts/audit-action-backing-entities.cjs`, `scripts/audit-releases-table.cjs`).

## Live database evidence for backing entities

| Concept | Tables found in PRIMARY | Verdict |
|---|---|---|
| Incidents | `alert_incidents`, `alert_incident_events` | real, usable |
| Alert silences | `alert_silences` (and `notification-routing.service.ts` calls `findActiveSilences`, so they are enforced) | real, usable |
| Connectors | 17 tables incl. `connector_configs`, `connector_deliveries`, `connector_delivery_attempts`, `connector_credentials`, `connector_circuit_state` | real, usable |
| Connector transports | `connector_type` enum = `email, slack, webhook, discord, teams, pagerduty, sms` | webhook + pagerduty both available |
| Releases | `project_releases` (columns: version, commit_sha, branch, released_by, released_at, metadata — **no status/state column**, 0 rows) | append-only record, nothing to "pause" |
| Runbooks | **NO TABLES** | no backing entity |
| Status page | **NO TABLES** | no backing entity |
| GitHub / Jira tickets | **NO TABLES**, no integration module | no backing entity |
| Reports | **NO TABLES** | no backing entity |
| Retention | **NO TABLES** in PRIMARY | platform concern, not per-workflow |
| AI | `ai_usage_logs`, `ai_model_routes`, `ai_prompt_templates` + real `AIAnalyzer` | real but requires credit/cost wiring |

## Available real integration surfaces

- `NotificationDispatcher.dispatch(row: ConnectorConfigRow, payload: NotificationPayload, opts)` — `src/modules/connectors/delivery/delivery.service.ts`. Already provides delivery-row persistence, first-attempt execution, retry scheduling, circuit breaker, usage recording, **and idempotency**: `insertDeliveryIdempotent` plus a `dedupKey` suppression window (`findDeliveryByDedupKey(connectorId, dedupKey, 5)` minutes).
- `NotificationPayload` carries `correlationId` (required) and `dedupKey` (documented as "Idempotency / dedup key for providers that support it") — this is the missing hook that lets automation's stable step idempotency key reach the external side effect.
- `ConnectorRepository.findById(orgId, id)` (tenant-scoped), `findFirstActiveByType(orgId, type)`, `getOrCreateManagedEmailConnector(orgId)`.
- `ConnectorService.retryDelivery(orgId, meta, deliveryId)`.
- `SilencesService.createSilence(orgId, meta, body)` where body = `{ ruleId?, comment?, startsAt, endsAt, matchers }`.
- `IncidentsRepository.openOrReuse(input)` (atomic, `ON CONFLICT ... WHERE status IN ('open','acknowledged')`, returns `created` via `xmax = 0`), `.appendEvent(input)`, `.assign(...)`.
- SSRF: every connector transport routes through `connectors/shared/http.ts::httpRequest()` which calls `validateWebhookUrl()` unless `skipSsrfCheck`.

## Decisions for all 28 action types

### Category A — already real, keep unchanged (2)

| Action | Why |
|---|---|
| `noop` | Genuinely does nothing, by definition. Honest. |
| `rollback.recommend` | Advisory-only by explicit design; produces a real recommendation output and never claims to have rolled back. |

### Category B — implement now against existing infrastructure (11)

| Action | Implementation route |
|---|---|
| `notification.send` | Resolve connector (explicit `connectorId` → tenant-scoped `findById`; else `channel` type → `findFirstActiveByType`; else `getOrCreateManagedEmailConnector`) then `NotificationDispatcher.dispatch` with `dedupKey`/`correlationId` = automation step idempotency key |
| `quota.notify` | Same path, `notificationType: 'automation.quota'` |
| `security.notify` | Same path, `notificationType: 'automation.security'` |
| `webhook.call` | Same dispatcher, restricted to a **pre-configured `webhook` connector the org already created**. Deliberately NOT an inline arbitrary URL — see security note below. |
| `pagerduty.trigger` | Same dispatcher with a `pagerduty` connector; PagerDuty natively honours `dedupKey` |
| `connector.delivery.retry` | `ConnectorService.retryDelivery` |
| `alert.silence.create` | `SilencesService.createSilence` |
| `incident.create` | `IncidentsRepository.openOrReuse` with a deterministic fingerprint derived from the automation step idempotency key (so retries fold into the same incident rather than opening duplicates) |
| `incident.timeline.append` | `IncidentsRepository.appendEvent` (constrained to the real `IncidentEventKind` union) |
| `incident.assign_owner` | `IncidentsRepository.assign` |
| `approval.request` | `automation_approvals` via the existing repository approval methods |

**Security note on `webhook.call`:** it is currently in `DANGEROUS_ACTIONS`, which forces manual approval on every single run — making it unusable in practice. Rather than weaken that, the implementation changes the *shape* of the action: it can only target a connector the organization has already created and validated. Consequences: the URL is SSRF-validated at connector creation and again on every send via `httpRequest`; credentials live in `connector_credentials` (encrypted) and never in workflow config; the org's existing connector permissions apply. That removes the need for per-run approval without weakening safety, so `webhook.call` leaves `DANGEROUS_ACTIONS`.

### Category C — real integration boundary, must FAIL EXPLICITLY when unavailable (6)

These stay in the product because the capability is meaningful and the entitlement/feature mapping already exists, but there is no backing implementation today. They are wired as injectable integrations and, when the integration is absent, they now return an explicit **failure** with `errorCode: 'INTEGRATION_NOT_CONFIGURED'` — never a fake success.

| Action | Missing dependency |
|---|---|
| `ai.summary.generate` | AI credit/cost-tracking wiring into the automation step path |
| `ai.root_cause.generate` | same |
| `incident.postmortem.generate_draft` | same (AI-backed) |
| `report.export` | no report-generation/storage subsystem exists (`report%` → NO TABLES) |
| `ticket.github.create` | no GitHub integration module exists |
| `ticket.jira.create` | no Jira integration module exists |

### Category D — remove from the product (9)

Removed rather than left as permanent fakes. Each has no backing entity, or is a duplicate, or is unsafe to expose to automation.

| Action | Justification for removal |
|---|---|
| `runbook.open` | `runbook%` → NO TABLES. No runbook entity exists anywhere in the schema or code. |
| `runbook.step.create` | Same. |
| `status_page.update` | `status_page%` → NO TABLES. No status-page subsystem. |
| `release.guard.warn` | Functionally a notification about a release; exact duplicate of `notification.send` with release context. Keeping both creates two ways to do one thing. |
| `release.guard.pause` | `project_releases` is an append-only historical record with no status/state column and no deployment-pipeline integration. There is literally nothing to pause. |
| `retention.archive` | No retention tables in PRIMARY; retention is a platform-level scheduled job, not a per-workflow tenant action. |
| `retention.purge_request` | Declared `critical` risk. Irreversible customer-data deletion must never be reachable from a tenant-authored automation rule. Explicitly out of scope by policy, not by convenience. |
| `quota.throttle_recommend` | Advisory-only duplicate of `quota.notify`; "recommend" produced no artifact anyone consumed. |
| `alert.severity.change` | Would fight the alerting decision engine, which computes and escalates severity itself (`openOrReuse` even does `severity = GREATEST(...)` to prevent downgrades). Letting automation mutate severity introduces a write-write conflict with the owning subsystem. |

Removing these requires coordinated edits to `ACTION_TYPES`, `DANGEROUS_ACTIONS` and `ACTION_FEATURE_MAP`, plus a data check that no existing `automation_actions` row references a removed type (all automation tables were empty except the 20 seeded `automation_templates`, which must be re-checked for removed action types before the removal lands).

## Net effect

| | Before | After |
|---|---:|---:|
| Action types advertised | 28 | 19 |
| Perform a real side effect | 2 | 13 |
| Silently fake success | 26 | **0** |
| Fail explicitly when unavailable | 0 | 6 |

---

## Seeded template audit (20 templates) — live evidence

`scripts/audit-template-triggers.cjs` + `scripts/audit-template-action-usage.cjs` against the live PRIMARY DB.

Three removal-candidate action types ARE referenced by seeded templates, so removal cannot be blind:

| Template | Actions | Decision |
|---|---|---|
| `open-runbook-for-critical-service` | `runbook.open -> notification.send` | **Remove template.** Its entire purpose is opening a runbook and no runbook entity exists. Keeping it with only `notification.send` would duplicate `alert-route-by-service-severity`. |
| `uptime-failure-status-page-draft` | `status_page.update -> approval.request` | **Remove template.** Needs BOTH a status-page subsystem (no tables) and an `uptime` module (does not exist in `src/modules`). Doubly fictional. |
| `release-health-guard` | `release.guard.warn -> notification.send` | **Remove template.** `release.guard.warn` is a duplicate of `notification.send`, and its `release.health_degraded` trigger has no producer. |

### Trigger-producer reality check (the deeper gap)

`sourceModule` values across the 20 templates: `alerting, billing, connectors, cron_monitoring, ingestion, monitoring, releases, scheduler, security, uptime`.

Modules that actually exist in `src/modules`: `ai, alerting, analytics, analytics-engine, auth, automation, billing, connectors, errors, event-analytics, feature-flags, ingestion, observability, organization, projects, scim, user-account, webhooks`.

So `cron_monitoring`, `monitoring`, `releases`, `uptime` have no owning module at all.

**More importantly — and this supersedes the per-module question:** nothing anywhere in the codebase publishes into `automation_events_inbox` except (a) the explicit `POST /organizations/:orgId/automation/events` API and (b) automation's own internal cron sweep. Verified by searching for cross-module callers of `insertInboxEvent` / the events endpoint. Therefore **every event-triggered template is currently inert regardless of its `sourceModule`**, because no producer feeds the inbox.

Consequence for this work: making automation genuinely work end-to-end requires wiring at least one real event producer, not just real actions. Priority is the `alerting` bridge, which unlocks 7 of the 20 templates:

| Trigger source | Templates | Producer status |
|---|---:|---|
| `alerting` | 7 | **to be wired** (highest value) |
| `scheduler` (`schedule.cron`) | 3 | **already real** — automation's own `runScheduleSweep` inserts these |
| `billing` | 2 | no producer |
| `connectors` | 1 | no producer |
| `ingestion` | 1 | no producer |
| `security` | 1 | no producer |
| `cron_monitoring` / `monitoring` / `releases` / `uptime` | 5 | no producer AND no owning module |

Templates whose actions are real but whose trigger has no producer (kept, documented as inert rather than deleted, because the capability is legitimate and only the producer is missing): `rollback-recommendation-with-approval`, `cron-missed-job-escalation`, `slo-burn-rate-incident`, `retry-ingestion-dead-letter`, `security-api-key-anomaly`, `ai-credit-usage-spike`, `notify-quota-threshold`, `retry-connector-dead-letter`.

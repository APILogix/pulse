# 27 — Alerting → Automation Event Contract

This is the canonical contract for domain events published from the alerting subsystem into automation. It is derived from what already exists in the repository, not invented from scratch:

- The **envelope** fields mirror what `AlertDecisionCandidate` and `alert_events_v2` already carry (organization, project, environment, service, severity, fingerprint, occurredAt).
- The **flat top-level payload fields** are dictated by the six existing alerting-sourced automation templates, whose conditions read `$.service`, `$.severity`, `$.incident_id`, `$.fingerprint_count`, `$.status`, `$.duration_minutes` directly off `event.payload` (`evaluateConditions(event.payload, conditions)` — `workers.ts:209`). The contract cannot introduce a nested envelope that would break those conditions; it must put these fields at the top level of `payload`.

## Why not the `{eventId, resource: {type,id}, data}` shape suggested in the brief

That shape was evaluated and rejected: it would nest the fields the six live templates expect under `data.*`, and every one of those templates would silently stop matching (conditions read `$.service`, not `$.data.service`). Changing 6 already-seeded template conditions to fix a contract that has no other consumer is a needless breaking change. The envelope metadata is carried instead in `automation_events_inbox.metadata` (a column that already exists for exactly this purpose) and in `sourceEventId`/`dedupeKey`, while `payload` stays flat and template-condition-compatible.

## Storage constraint that changed the outbox table decision

The Log DB (Neon project, host `ep-steep-dream-b3brc5q5`) is at its 512 MB storage limit. `CREATE TABLE` for a dedicated `alert_domain_outbox` table failed live with `could not extend file because project size limit (512 MB) has been exceeded` — verified by isolating each DDL statement; even a minimal single-column table failed, while a catalog-only `ALTER TABLE ... ADD CONSTRAINT` on an *existing* table succeeded. The wall is specifically on allocating new storage (new relfilenodes), not all writes.

Given that constraint, the outbox reuses the existing `telemetry_outbox` table instead of a new one:

- `telemetry_outbox.signal_kind` CHECK constraint widened (again — this table already went through this once for `error_group_regressed`) to add `'alert_domain_event'`. This is a catalog-only `ALTER TABLE`, confirmed to succeed under the current storage constraint.
- Alert domain event rows are written with `fast_path = FALSE`, so `TelemetryOutboxRelay`'s own claim query (which filters `fast_path = TRUE`) can never see or race with them.
- A new `AlertDomainOutboxRelay` class claims rows filtered by `signal_kind = 'alert_domain_event'` exclusively — a disjoint claim predicate from the telemetry relay's, so the two relays never compete for the same row.
- The full event payload (the `AlertAutomationEventPayload` below, plus envelope metadata) is stored in `telemetry_outbox.attributes` (JSONB), namespaced under `{ eventType, alertKey, dedupeKey, payload, metadata }` so it doesn't collide with telemetry's own attribute shape.
- `event_id` (the column, not the domain concept) carries the dedupe key, fitting the existing `uq_telemetry_outbox_idem (organization_id, signal_kind, event_id, created_at)` arbiter without a new index.

This is a disclosed compromise, not a silent one: the clean-separation design (a dedicated table) is what this document originally specified and remains the better long-term shape. If/when the Log DB has storage headroom (plan upgrade, or pruning of the 127 MB `events_spans_default`/63 MB `events_traces_default` tables — neither pruned here, as that is a destructive, data-owning decision this task does not have authorization to make), migrating this to its own table is a mechanical follow-up: same relay logic, same claim semantics, just against a dedicated relation instead of a shared one filtered by `signal_kind`.

## The contract

```ts
/**
 * Canonical alerting -> automation event payload.
 * Top-level fields are readable directly via $.<field> in automation conditions.
 */
interface AlertAutomationEventPayload {
  // ── Identity (flat, for condition matching against existing templates) ──
  alert_key: string;            // stable alert identity (== alert_events_v2.fingerprint)
  fingerprint_count: number;    // duplicate_count + 1 (>=1); used by deduplicate-noisy-alerts
  service: string | null;
  severity: 'debug' | 'info' | 'warning' | 'error' | 'critical' | 'fatal';
  status: 'firing' | 'resolved';                 // derived from event kind, matches escalate-unresolved-critical-alert's $.status neq 'resolved'
  incident_id: string | null;                     // primary-DB incident, if one was opened/resolved
  duration_minutes: number | null;                // resolved events only: firing duration
  environment: string | null;
  project_id: string | null;
  rule_id: string | null;
  observed_value: number | null;
  threshold_value: number | null;
  labels: Record<string, unknown>;
  occurred_at: string;                            // ISO-8601
}

// automation_events_inbox row shape this maps onto:
{
  organizationId: string;                          // alert_events_v2.organization_id
  projectId: string | null;
  sourceModule: 'alerting';
  eventType: 'alert.event.created' | 'alert.event.resolved';   // matches TRIGGER_TYPES already in types.ts
  sourceEventId: string;                            // alert_events_v2.id (the fact row's own UUID)
  dedupeKey: string;                                // `alert:{eventType}:{alert_events_v2.idempotency_key}`
  payload: AlertAutomationEventPayload;
  metadata: {
    alertEventId: string;                           // alert_events_v2.id, duplicated for clarity in metadata
    ruleId: string | null;
    bindingId: string | null;
    engine: string;                                 // 'fast' | 'window' | ...
    source: string;
  };
}
```

## Field derivation

| Field | Source |
|---|---|
| `alert_key` | `alert_events_v2.fingerprint` (== the alert identity computed by `alertFingerprint`/`alertIdentityHash`) |
| `fingerprint_count` | `alert_incidents.occurrence_count` (returned by `persistIncident()`'s `openOrReuse()` call — this is the "how many times has this exact fingerprint fired" counter; `alert_event_state.duplicate_count` was considered and rejected, because that column counts idempotency-key collisions within the fast-path collapse window, not real-world recurrence, which is not what `deduplicate-noisy-alerts`' `$.fingerprint_count gt 5` condition means). Falls back to `1` if no incident was opened (`persistIncident` returns null when the incidents repository is not configured, or on failure — both already handled, see `decide()` lines ~232-237). |
| `service` | `alert_events_v2.service` |
| `severity` | `alert_events_v2.severity` (already `logdb_severity`) |
| `status` | `'firing'` when `kind === 'fired'`, `'resolved'` when `kind === 'recovered'` |
| `incident_id` | the `incidentId` already resolved by `persistIncident()` in `decide()`, before the Log DB transaction |
| `duration_minutes` | resolved events only: `(resolvedAt - firstSeenAt) / 60000`, using `alert_event_state.first_seen_at` |
| `environment`, `project_id`, `rule_id`, `observed_value`, `threshold_value`, `labels` | same-named columns on `alert_events_v2` |
| `occurred_at` | `alert_events_v2.occurred_at` |

## Bounded size / no secrets

- `evidence`/`policy_snapshot` from `alert_events_v2` are **not** forwarded — they can be large and are meant for the alerting UI, not automation. Only `labels` is forwarded (bounded, already used for routing).
- No credential, token, or connector secret ever reaches this payload; alerting has no such data on this table in the first place.
- Payload size is bounded by the same `LIMITS.MAX_PAYLOAD_SIZE_BYTES` (256 KB) the explicit `/events` API already enforces — the publisher path is exempt from the API's own check (it doesn't go through `service.ingestEvent`) but the payload shape above is small and fixed, not proportional to `evidence`, so it stays far under the limit by construction.

## Idempotency

`dedupeKey = alert:{eventType}:{alert_events_v2.idempotency_key}`. `alert_events_v2.idempotency_key` is already the mechanism that makes `alert_events_v2` itself idempotent (`hash(alertKey:kind:observedAt)`), so reusing it means: if `decide()` ever collapses a duplicate decision (`event === null` path), no outbox row is written at all (see §Implementation), and if the outbox row is somehow re-published, `automation_events_inbox`'s own `UNIQUE (organization_id, dedupe_key) NULLS NOT DISTINCT` index collapses it before it can create a second run.

## Event types

Only two are added, both already present in `TRIGGER_TYPES` (`src/modules/automation/types.ts`) and already mapped in `TRIGGER_FEATURE_MAP` (`entitlements.ts`) — no schema or entitlement change needed for the trigger side:

- `alert.event.created` — published when an alert's state machine transitions via `'trigger'` (i.e. `kind === 'fired'`) **and a real event row was appended** (not a collapsed duplicate).
- `alert.event.resolved` — published when the transition is `'recover'` (`kind === 'recovered'`) and a real event row was appended.

Deliberately **not** published from this bridge in this phase (no live template needs them yet, and inventing an event with no consumer would be exactly the kind of premature engineering this task warns against): `acknowledged`, `escalated`, `silenced`, `suppressed`. `escalate-unresolved-critical-alert`'s condition (`$.status neq 'resolved'`) is satisfiable from `alert.event.created` alone — it fires on any active critical alert, then re-evaluates on the next fired event for the same alert key, which is the existing dedupe/duplicate-collapse behavior already in `decide()`.

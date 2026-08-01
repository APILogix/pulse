# Phases 7, 8, 9, 12, 13 — Decision Engine, Connector Isolation, Escalation, Preferences

## 1. Alert Decision Engine (`alert.decide`)

Input: `{ candidate, policy }`. The engine performs **mechanics only** (Phase 18 §13). Every step below
runs in a single Log DB transaction.

```text
1  if policy.decision == 'drop'      → record alert_rule_executions row, stop (no usage)
2  if policy.decision == 'denied'    → append alert_events(kind='suppressed'),
                                        history(reason=entitlement), usage NOT counted, stop
3  if policy.decision == 'suppress'  → append alert_events(kind='suppressed'),
                                        history(silence/window id), usage NOT counted, stop
4  if policy.decision == 'delay'     → append alert_events(kind='fired'), state=pending,
                                        schedule alert.decide at policy.maintenance.notifyAfter, stop
5  dedup: SELECT alert_event_state WHERE alert_key = org:fingerprint FOR UPDATE
     ├─ active row within policy.dedup.windowSeconds → duplicate_count++,
     │    append alert_events(kind='duplicate'), usage NOT counted (never charge duplicates), stop
     └─ else continue
6  cooldown: state.last_notified_at + policy.cooldown.seconds > now() → append duplicate, stop
7  append alert_events(kind='fired', policy_snapshot=policy)
8  upsert alert_event_state (state='firing', severity, first/last_seen, auto_resolve_at,
     escalation cursor from policy.escalation.steps[0])
9  insert alert_event_history('triggered')
10 insert alert_notification_jobs  ← policy.channels × policy.recipients (unique idem key)
11 insert alert_notification_ledger rows (throttle accounting)
12 insert alert_usage_events (kind='alert_generated', billable per policy.usage)
13 insert alert_metrics row
COMMIT
14 after commit: publish notification.route (job ids only) + alert.correlate (if correlation intent)
```

Key properties:
- Publication strictly after commit (invariant 5).
- `FOR UPDATE` on the state row serializes concurrent decisions for the same alert key, so two
  workers evaluating the same rule in the same second cannot both fire.
- Duplicates and suppressions are never billed (requirement).
- The job rows carry everything transport needs; nothing is left to be resolved later.

### Alert state machine

```text
                 ┌──────────── duplicate (count++) ────────────┐
                 ▼                                             │
pending ──▶ firing ──▶ acknowledged ──▶ resolved ──▶ (retention drop)
   │           │  ▲          │
   │           │  └── ack expiry (escalation resume) ──┘
   │           ├──▶ suppressed   (silence / maintenance window)
   │           ├──▶ silenced     (matcher silence)
   │           ├──▶ expired      (auto-resolve TTL)
   └──────────▶ error            (all transports failed)
```

`expired` is a new terminal state so retention no longer has to conflate "auto-resolved" with
"never resolved" (audit found no expired/archived state at all). Archival = partition detach.

## 2. Notification Router (`notification.route`)

Pure fan-out, no policy:

```text
for each notification_job_id:
  load job (LOGDB, by id)
  if job.status != 'pending' → skip (idempotent)
  if channel_kind == 'in_app' → mark 'sent' (the alert event IS the in-app notification), usage delivered
  else → publish connector.<channel_kind> with { jobId, organizationId, connectorId, payload, idempotencyKey }
         mark job 'queued'
```

The router is the only component that knows the mapping `channel_kind → queue name`. This is what
lets a new provider be added without touching the Decision Engine or the Policy Engine.

## 3. Connector workers — transport only (Phase 8)

The `NotificationJob` is the entire input contract:

```ts
export interface NotificationJob {
  jobId: string;
  organizationId: string;
  connectorId: string | null;     // null = platform-managed transport
  channelKind: NotificationChannelKind;
  recipientRef: string;           // already resolved by the Policy Engine
  idempotencyKey: string;
  severity: NotificationSeverity;
  payload: {                      // already rendered
    title: string; body: string;
    fields?: Array<{ label: string; value: string }>;
    url?: string; threadKey?: string;
    metadata?: Record<string, unknown>;
  };
}
```

Connector worker responsibilities, and nothing else:

1. Consume global rate token (`connector_rate_buckets`, atomic UPSERT).
2. Check global circuit (`connector_circuit_state`).
3. Load + decrypt connector credentials; instantiate the provider from the registry.
4. Insert/find `connector_deliveries` by `(connector_id, idempotency_key)` — idempotent.
5. Call the provider.
6. Record outcome: `connector_deliveries` + `connector_delivery_attempts` + circuit update.
7. On retryable failure: schedule via `next_retry_at` (exp backoff + full jitter, preserved from
   today) → `connector.retry` sweep. On terminal failure: `connector_dead_letters` + `connector.dlq`.
8. Report the outcome back by updating the `alert_notification_jobs.status` and writing
   `alert_usage_events(kind='alert_delivered' | 'alert_failed', channel-specific kind)`.

Explicitly forbidden in connector workers (enforced by an import-boundary lint rule): importing
`modules/alerting/**`, reading `alert_rules*`, resolving recipients, reading preferences, reading
entitlements, reading routing rules.

Step 8 is the one place transport touches alert-owned tables. It writes **status and usage only**,
never policy. That keeps the "connector workers must never understand alert logic" rule intact while
still closing the loop that the audit found broken (attempts stuck at `queued`).

### Provider set

Preserved as-is: `email` (SMTP, incl. per-connector override), `slack` (webhook or bot token),
`discord`, `teams`, `pagerduty` (Events API v2), `webhook` (HMAC-signed, SSRF-guarded), `sms` (Twilio).
Adding a provider = register in the connector registry + add one queue + one `notification_channel_kind`
enum value. No changes to policy, decision, or routing code.

## 4. Escalation Engine (Phase 12)

Escalation is a separate worker (`alert.escalate`) that executes only the **resolved** policy stored on
the alert event, never re-resolving business rules.

```text
Critical alert fires
  ├─ step 0: channels [slack]      (immediate)
  ├─ wait 5m → if state != acknowledged → step 1: channels [pagerduty]
  ├─ wait 10m → if state == firing   → step 2: channels [sms]
  └─ steps exhausted → repeat per policy.escalation.repeatIntervalMinutes (bounded by maxRepeats)
```

Mechanics:
- Claim due rows: `alert_event_state WHERE state='firing' AND next_escalation_at <= now() FOR UPDATE SKIP LOCKED`.
- Read `alert_events.policy_snapshot.escalation` for the step definition — so editing the policy
  mid-incident does not retroactively change an in-flight escalation (deterministic incident replay).
- Create `alert_notification_jobs` with `escalation_step = N` (the idempotency key includes the step,
  so a retried sweep cannot double-page).
- Expired acknowledgments resume escalation (preserved from today's `resumeExpiredAcknowledgments`).
- Every transition appends `alert_event_history`.

## 5. Notification preferences (Phase 13)

All resolution happens in the Policy Engine, stage 7. Precedence, most specific wins:

```text
user_notification_preferences        (vacation_until, muted_until, min_severity, channel prefs)
  ↓ overrides
project_member_alert_channel_preferences (per channel + category)
  ↓ overrides
project_connector_subscriptions      (category, severity, member scoping, quiet hours, digest)
  ↓ overrides
project_notification_preferences     (project defaults, role targets, default channels/members)
  ↓ overrides
organization defaults                (plan-derived)
```

| Capability | Source |
|---|---|
| User preferences | `user_notification_preferences` (new) |
| Project preferences | `project_notification_preferences` (existing) |
| Team preferences | `project_notification_preferences.role_targets` + team ids in `recipient_overrides` |
| Organization preferences | plan defaults + org-level `alert_channel_bindings` |
| Quiet hours | existing project/member/subscription `quiet_hours` + new user-level |
| Digest mode | existing `digest_mode`; non-`immediate` recipients are routed to a digest job instead of being dropped |
| Severity filters | `min_severity` / `severity_threshold` ladder (existing) |
| Temporary muting | `user_notification_preferences.muted_until` (new) |
| Vacation mode | `user_notification_preferences.vacation_until` (new) |

Digest handling is a genuine gap-fill: today non-immediate recipients are simply filtered out. The
Decision Engine instead writes a `digest` notification job with `notifyAfter` set to the digest
boundary, and a `notification.digest` collapse step batches them. Nothing is silently dropped.

## 6. Correlation (Phase 14)

`alert.correlate` runs after commit and is advisory — it never blocks delivery.

| Feature | Mechanism |
|---|---|
| Duplicate detection | `fingerprint` + `alert_event_state.duplicate_count` (existing, preserved) |
| Grouping | `group_key` from `grouping_key_template`; groups collapse within `grouping_wait_seconds` |
| Composite alerts | rule with multiple condition groups; the Window Engine evaluates groups (OR) / ungrouped (AND) as today, and a composite rule may reference other rules' `alert_event_state` |
| Correlation | `correlation_key` (default `org:project:service:window`) → `alert_correlation_groups` |
| Incident creation | `incidentIntent = create|attach` → `alert_incidents`, linked via `alert_event_state.incident_id` |
| Noise reduction | when a correlation group exceeds N members in a window, later members attach silently (no new notification) — recorded as `kind='duplicate'`, non-billable |
| Root cause linking | `root_cause_hint` populated from the earliest member + deployment/service signals |
| AI prioritization | `alert_incidents.ai_priority_score` written by an optional, flag-gated hook; absence never blocks anything |

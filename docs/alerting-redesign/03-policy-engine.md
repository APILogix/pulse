# Phase 18 — Alert Policy Engine

The Policy Engine is the central business-policy layer. It sits between the evaluation engines and
the Decision Engine, and it is the **only** component permitted to interpret configuration.

## 1. Form factor: library, not a queue hop

It is a **stateless, dependency-injected library** (`modules/alerting/policy/`) invoked in-process by
both evaluators. It is not its own pg-boss queue.

Why: the fast path has a <500ms budget; an extra queue hop costs a claim + publish + poll (~100–200ms
p99) and adds a failure surface with no correctness benefit, because the engine is pure. The user's
own queue topology contains no policy queue, which matches. Being a library still preserves the
architectural boundary: it has no DB writes, no provider access, and its only output is the immutable
policy object. See ADR-0002.

## 2. Interface

```ts
export interface PolicyEngineDeps {
  configRepo: AlertConfigRepository;       // PRIMARY pool only
  entitlements: EntitlementResolver;
  preferences: PreferenceResolver;
  channels: ChannelResolver;
  clock: Clock;                            // injected for deterministic tests
  cache: PolicyCache;                      // read-through, TTL + version-keyed
  logger: FastifyBaseLogger;
}

export interface AlertPolicyEngine {
  resolve(candidate: AlertCandidate): Promise<EffectiveAlertPolicy>;
}
```

Guarantees (Phase 18 §14):

| Requirement | How it is met |
|---|---|
| Deterministic | Pure function of (candidate, config snapshot, clock). No randomness. Same inputs ⇒ byte-identical policy hash. |
| Idempotent | No writes. Callable N times per candidate. |
| Horizontally scalable | No shared mutable state. |
| Stateless | All state is passed in or read through the cache. |
| Independently testable | Deps injected; fixtures are plain config rows. |
| Cache-friendly | Config reads keyed by `(orgId, configVersion)`; invalidated by `organizations.config_version` bump on any alerting config write. |
| Extensible | New channels/providers register in the `ChannelResolver` registry, not in the engine. |
| Reusable | Same call site for Fast and Window engines. |
| Traceable | Every stage appends a `PolicyTraceEntry`; the trace is stored on the alert event as `policy_snapshot.trace`. |

## 3. Resolution stages (in strict order)

The engine short-circuits as soon as a stage decides "do not notify", but it always returns a
complete, explainable policy — never `null`.

```text
 1 Rule Resolution        → effective rule (inheritance fold)
 2 Threshold Resolution   → effective threshold for the scope chain
 3 Scope Resolution       → effective scope (org/project/env/service/endpoint)
 4 Action Resolution      → merged/overridden/disabled action set
 5 Maintenance Policy     → suppress | delay | allow  (silences + windows)
 6 Correlation Policy     → fingerprint, dedup key, group key, correlation key, incident intent
 7 Recipient Resolution   → eligible users (prefs, quiet hours, vacation, severity, digest)
 8 Channel Resolution     → requested channel kinds → ordered channel plan
 9 Connector Resolution   → channel plan → concrete transports + fallbacks
10 Entitlement Resolution → allow/deny per channel + limits
11 Usage Policy           → what is billable
12 Escalation Policy      → resolved ordered steps with waits
    ⇒ EffectiveAlertPolicy (frozen)
```

Stage details that differ from today's behaviour:

- **Stage 1–3** implement `alert_rule_bindings` folding (`02-data-model.md` §1). The engine returns
  exactly one effective rule; duplicated inherited rules are impossible by construction.
- Organization bindings publish a rule to the org catalog; projects opt in with their own binding,
  commonly `mode='inherit'`. This keeps org-enabled rules from becoming mandatory for every project.
- **Stage 5** is evaluated *before* recipients so a suppressed alert costs no recipient queries and is
  guaranteed non-billable. `delay` returns `notifyAfter`, consumed by the Decision Engine as a
  scheduled job rather than an immediate one.
- **Stage 7** preserves the existing, working resolver semantics (active membership, category match,
  severity ladder, digest `immediate`, quiet hours, fail-closed for project events) and adds
  `user_notification_preferences` (vacation mode, temporary mute, per-user channel prefs).
- **Stage 9** implements the fallback chain from the brief, including managed SMTP.
- **Stage 10** is the enforcement point the audit found missing. Denied channels are dropped from the
  plan with a reason; if all channels are denied the policy is `decision = 'denied'`.

## 4. Channel → connector resolution (Phases 9 + 18 §5–6)

```text
requested channel: email
  org/project alert_channel_bindings for 'email', priority DESC
    ├─ connector_id set + connector active?  → org SMTP connector
    ├─ use_managed_fallback && entitlement channels.managed_smtp → Pulse Managed SMTP
    └─ neither → channel unavailable (reason: no_transport)

requested channel: slack
  ├─ binding with active slack connector → slack connector
  ├─ fallback_channel_kind = 'email' && policy allows → recurse into email
  └─ else unavailable (reason: connector_missing)

requested channel: pagerduty
  ├─ entitlement integrations.pagerduty ? else denied (reason: entitlement)
  ├─ active pagerduty connector ? else unavailable
  └─ deliver
```

Rules never name a connector id. Existing `alert_rule_actions.connector_id`/`route_id` rows are
migrated to `requested_channels` derived from the connector's provider, and the columns are retained
(nullable, deprecated) for one release so rollback is possible.

## 5. `EffectiveAlertPolicy` contract

```ts
export interface EffectiveAlertPolicy {
  readonly policyId: string;          // sha256 of the resolved content — stable, comparable
  readonly candidateKey: string;      // candidate.idempotencyKey
  readonly decision: 'notify' | 'suppress' | 'delay' | 'denied' | 'drop';
  readonly reason: string;

  readonly scope: {
    organizationId: string; projectId: string | null;
    environment: string | null; service: string | null; endpoint: string | null;
    resolvedScopeType: AlertScopeType; resolvedScopeLevel: 0|1|2|3|4;
  };

  readonly rule: {
    ruleId: string | null; bindingId: string | null; revision: number | null;
    name: string; enabled: boolean;
    severity: AlertSeverity; priority: number;
  };

  readonly threshold: {
    fieldPath: string | null; operator: string | null;
    value: number | string | null; lookbackMinutes: number | null;
    aggregateFunction: string | null; consecutiveBreaches: number;
    observedValue: number | null;
  };

  readonly dedup: { fingerprint: string; dedupKey: string; windowSeconds: number };
  readonly cooldown: { seconds: number; lastNotifiedAt: string | null };
  readonly grouping: { enabled: boolean; groupKey: string | null; waitSeconds: number };
  readonly correlation: {
    correlationKey: string | null; strategy: string;
    incidentIntent: 'none' | 'attach' | 'create'; rootCauseHint: Record<string, unknown>;
  };

  readonly maintenance: {
    state: 'allow' | 'suppress' | 'delay';
    matchedSilenceId: string | null; matchedWindowId: string | null;
    notifyAfter: string | null;
  };

  readonly recipients: ReadonlyArray<{
    userId: string; ref: string; channelKind: NotificationChannelKind;
    projectChannelId: string | null; digestMode: string;
  }>;

  readonly channels: ReadonlyArray<{
    kind: NotificationChannelKind;
    connectorId: string | null;      // null = managed transport or in_app
    routeId: string | null;
    templateId: string | null;
    managed: boolean;
    fallbackOf: NotificationChannelKind | null;
    order: number;
  }>;

  readonly escalation: {
    policyId: string | null;
    steps: ReadonlyArray<{ stepNumber: number; waitMinutes: number;
      channels: NotificationChannelKind[]; notifyOnCall: boolean; templateId: string | null }>;
    repeatIntervalMinutes: number | null; maxRepeats: number;
  };

  readonly entitlement: {
    allowed: boolean;
    deniedChannels: ReadonlyArray<{ kind: NotificationChannelKind; featureKey: string }>;
    dailyRemaining: number | null; monthlyRemaining: number | null;
  };

  readonly usage: {
    countGenerated: boolean;         // false when suppressed
    countDelivered: boolean;
    countRetries: boolean;           // always false — retries are never billed
    billableChannels: ReadonlyArray<NotificationChannelKind>;
  };

  readonly trace: ReadonlyArray<{ stage: string; outcome: string; detail?: Record<string, unknown> }>;
}
```

The object is frozen (`Object.freeze` deep) before return. Downstream stages consume only this.

## 6. Caching and invalidation

Per-org config snapshot (`rules + conditions + actions + bindings + channel bindings + silences +
windows + escalation + preferences + entitlements`) is cached in-process, keyed by
`(organizationId, configVersion)`, TTL 30s, max ~2k orgs LRU.

`organizations.config_version INTEGER NOT NULL DEFAULT 1` is bumped by trigger on write to any
alerting/connector configuration table. A cache miss or version bump reloads in one batched query set.
This keeps steady-state policy resolution at ~1–3 queries per *org per 30s* rather than per alert,
which is what makes millions of events/day affordable.

Silences and maintenance windows are time-sensitive, so their evaluation always uses `clock.now()`
against cached rows (rows change rarely; time does not need cache invalidation).

## 7. Decision Engine after the refactor (Phase 18 §13)

The Decision Engine loses all business logic and keeps only mechanics:

1. Fingerprint + dedup check against `alert_event_state`.
2. Alert state machine transition.
3. Persist `alert_events` (append) + upsert `alert_event_state` + `alert_event_history`.
4. Create `alert_notification_jobs` from `policy.channels × policy.recipients`.
5. Schedule escalation (`next_escalation_at` from `policy.escalation.steps[0]`).
6. Emit runtime metrics + audit.
7. Write `alert_usage_events` per `policy.usage`.

All of 1–7 for a single alert happen in **one Log DB transaction**, so an alert event and its
notification jobs and usage rows are all-or-nothing. Queue publication happens after commit (the
router reads jobs by id), preserving the no-publish-before-commit rule.

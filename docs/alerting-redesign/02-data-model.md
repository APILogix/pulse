# Phases 1–4, 9–11, 14 — Data Model

All DDL below is the target design. Ordered, reversible migration files are listed in
`07-migration-plan.md`. `PRIMARY` = control-plane database, `LOGDB` = Log DB.

---

## 1. Rule inheritance — `alert_rule_bindings` (PRIMARY)

The existing `alert_rules.project_id` cannot express inherit/override/disable, and cannot express
environment/service/endpoint scope. Rather than widen `alert_rules`, the **definition** stays
org-owned and **scope behaviour** moves into bindings.

```sql
CREATE TYPE alert_scope_type AS ENUM ('organization','project','environment','service','endpoint');
CREATE TYPE alert_binding_mode AS ENUM ('inherit','override','disable');
CREATE TYPE alert_action_merge_mode AS ENUM ('inherit','merge','replace');

CREATE TABLE alert_rule_bindings (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id                     UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,

  scope_type                  alert_scope_type NOT NULL,
  -- scope_level is the precedence ladder: organization=0 … endpoint=4
  scope_level                 SMALLINT NOT NULL,
  project_id                  UUID REFERENCES projects(id) ON DELETE CASCADE,
  environment                 VARCHAR(64),
  service                     VARCHAR(255),
  endpoint                    VARCHAR(500),

  mode                        alert_binding_mode NOT NULL DEFAULT 'inherit',
  enabled                     BOOLEAN NOT NULL DEFAULT TRUE,
  priority                    INTEGER NOT NULL DEFAULT 100,

  -- scalar overrides (NULL = inherit from parent scope)
  severity                    alert_severity,
  cooldown_seconds            INTEGER CHECK (cooldown_seconds IS NULL OR cooldown_seconds >= 0),
  deduplication_window_seconds INTEGER CHECK (deduplication_window_seconds IS NULL OR deduplication_window_seconds >= 0),
  auto_resolve_after_minutes  INTEGER,
  evaluation_interval_seconds INTEGER CHECK (evaluation_interval_seconds IS NULL OR evaluation_interval_seconds > 0),
  consecutive_breaches        INTEGER CHECK (consecutive_breaches IS NULL OR consecutive_breaches >= 1),

  -- threshold overrides keyed by condition field_path: {"errors.rate": 2}
  threshold_overrides         JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- action/recipient/channel overrides
  action_mode                 alert_action_merge_mode NOT NULL DEFAULT 'inherit',
  requested_channels          JSONB,   -- ["slack","email"] — channels, never connector ids
  recipient_overrides         JSONB,   -- {"userIds":[],"roles":["owner"],"teamIds":[]}
  escalation_policy_id        UUID REFERENCES alert_escalation_policies(id) ON DELETE SET NULL,

  notes                       TEXT,
  created_by                  UUID REFERENCES users(id),
  updated_by                  UUID REFERENCES users(id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                  TIMESTAMPTZ,

  CONSTRAINT ck_binding_scope_shape CHECK (
    (scope_type = 'organization' AND scope_level = 0 AND project_id IS NULL AND environment IS NULL AND service IS NULL AND endpoint IS NULL) OR
    (scope_type = 'project'      AND scope_level = 1 AND project_id IS NOT NULL AND environment IS NULL AND service IS NULL AND endpoint IS NULL) OR
    (scope_type = 'environment'  AND scope_level = 2 AND project_id IS NOT NULL AND environment IS NOT NULL AND service IS NULL AND endpoint IS NULL) OR
    (scope_type = 'service'      AND scope_level = 3 AND project_id IS NOT NULL AND service IS NOT NULL AND endpoint IS NULL) OR
    (scope_type = 'endpoint'     AND scope_level = 4 AND project_id IS NOT NULL AND endpoint IS NOT NULL)
  ),
  CONSTRAINT ck_binding_env_format CHECK (
    environment IS NULL OR (char_length(environment) BETWEEN 1 AND 64
      AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$')
  )
);

-- exactly one live binding per (rule, scope tuple)
CREATE UNIQUE INDEX uq_alert_rule_binding_scope
  ON alert_rule_bindings (rule_id, scope_type, project_id, environment, service, endpoint)
  NULLS NOT DISTINCT
  WHERE deleted_at IS NULL;

CREATE INDEX idx_alert_rule_bindings_resolve
  ON alert_rule_bindings (organization_id, rule_id, scope_level DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_alert_rule_bindings_project
  ON alert_rule_bindings (project_id, scope_level DESC)
  WHERE deleted_at IS NULL AND project_id IS NOT NULL;

CREATE TRIGGER trg_alert_rule_bindings_updated_at
  BEFORE UPDATE ON alert_rule_bindings
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();
```

### Effective Rule Resolution algorithm (deterministic)

For evaluation context `C = (org, project, environment, service, endpoint)` and rule `R`:

1. Select all live bindings of `R` whose scope tuple is a **prefix match** of `C`
   (org always matches; project matches if equal; etc.). Order by `scope_level ASC`.
2. If `C` includes a project and the only matching binding is organization-scope, the rule is
   **not subscribed** for that project and resolves disabled. Organization scope is a catalog-level
   enablement; projects opt in with their own binding. A plain project subscription is
   `scope_type='project', mode='inherit'` with no overrides.
3. Fold in order, deepest wins per field. `NULL` means "inherit", so it never overwrites.
4. `mode='disable'` sets `resolved.enabled = false`. A **deeper** binding with
   `mode='override', enabled=true` re-enables. This is what makes "Project A disable, Endpoint
   /payment override 0.5%" behave correctly.
5. `action_mode`: `inherit` keeps parent actions, `merge` unions parent+child, `replace` discards
   parent actions.
6. Tie-break at equal depth (possible only for `service` vs `endpoint` on the same project):
   higher `priority`, then `scope_level DESC`, then `created_at ASC`. Deterministic and documented.
7. Result is **one** effective rule. The evaluator never evaluates the parent copy again.

Worked example (matches the brief):

| Scope | Binding | Effective for `/payment` in prod |
|---|---|---|
| Organization | `errors.rate >= 5` (inherit) | base |
| Project A | `disable` | A produces nothing |
| Project B | override `2` | B = 2% |
| Environment prod (B) | override `1` | B/prod = 1% |
| Endpoint `/payment` (B) | override `0.5` | **0.5% — the only rule executed** |

### `alert_rule_revisions` (PRIMARY) — Phase 2 gap D8

```sql
CREATE TABLE alert_rule_revisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id         UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  revision        INTEGER NOT NULL,
  change_kind     VARCHAR(40) NOT NULL,  -- rule|condition|action|binding
  snapshot        JSONB NOT NULL,        -- full rule+conditions+actions+bindings
  actor_user_id   UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alert_rule_revision UNIQUE (rule_id, revision)
);
CREATE INDEX idx_alert_rule_revisions_rule ON alert_rule_revisions (rule_id, revision DESC);
```

`alert_rules` gains `current_revision INTEGER NOT NULL DEFAULT 1`. Every write bumps it inside the
same transaction that inserts the revision row.

---

## 2. Thresholds as a rule layer (Phase 4)

`project_alert_thresholds` becomes a **source for migration**, not a parallel engine. Each of the 13
seeded threshold keys maps to a preset rule + a binding:

| threshold_key | preset rule | binding scope |
|---|---|---|
| `error_rate` | `high_error_rate` | project (or environment when `environment_id` set) |
| `latency_p95` | `high_latency_p95` | project/environment |
| `latency_p99` | `high_latency_p99` | project/environment |
| `apdex`, `event_volume_spike`, `event_volume_drop`, `failed_notification_rate`, `ingestion_error_rate`, `rate_limit_usage`, `ai_usage_cost` | new presets `apdex_low`, `traffic_spike`, `traffic_drop`, `failed_notification_rate`, `ingestion_error_rate`, `rate_limit_pressure`, `ai_cost_spike` | project/environment |
| `latency_p50/p75/p90` | `latency_percentile` preset with `aggregate_function` | project/environment |

The migration is data-preserving: `threshold_value → threshold_overrides`,
`cooldown_minutes*60 → cooldown_seconds`, `consecutive_breaches → consecutive_breaches`,
`evaluation_window_minutes → condition.lookback_minutes`, `enabled=false → mode='disable'`,
`environment_id → environment` (resolved to the environment slug string).

After cutover `ProjectThresholdWorker` is deleted; its metric SQL is preserved by moving each
expression into the Window Engine's metric registry (nothing is lost, including the
`project_usage_minute` rollup reads and the deliberate absence of non-composable percentiles from
additive rollups — those keep using `events_requests`).

---

## 3. Alert runtime, typed and append-oriented (LOGDB)

Replaces the generic 9-table loop. `alert_events` is append-only; `alert_event_state` is the single
mutable projection (ADR-0006).

```sql
CREATE TYPE alert_event_kind AS ENUM ('fired','recovered','duplicate','suppressed','silenced');

CREATE TABLE alert_events (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL,
  project_id        UUID,
  environment       VARCHAR(64),
  service           VARCHAR(255),
  endpoint          VARCHAR(500),
  rule_id           UUID,                      -- identifier only, never an FK
  binding_id        UUID,
  rule_revision     INTEGER,
  kind              alert_event_kind NOT NULL,
  severity          logdb_severity NOT NULL,
  priority          SMALLINT NOT NULL DEFAULT 0,
  fingerprint       VARCHAR(255) NOT NULL,
  dedup_key         VARCHAR(255) NOT NULL,
  correlation_key   VARCHAR(255),
  group_key         VARCHAR(255),
  source            VARCHAR(100) NOT NULL,
  engine            VARCHAR(16) NOT NULL,      -- 'fast' | 'window' | 'reconcile' | 'api'
  idempotency_key   VARCHAR(255) NOT NULL,
  observed_value    NUMERIC(20,6),
  threshold_value   NUMERIC(20,6),
  evidence          JSONB NOT NULL DEFAULT '{}'::jsonb,
  policy_snapshot   JSONB NOT NULL DEFAULT '{}'::jsonb,  -- the EffectiveAlertPolicy actually used
  labels            JSONB NOT NULL DEFAULT '{}'::jsonb,
  annotations       JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at       TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_alert_events_environment CHECK (
    environment IS NULL OR (char_length(environment) BETWEEN 1 AND 64
      AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$')
  )
) PARTITION BY RANGE (created_at);

-- exactly-once decisioning (fixes audit C3)
CREATE UNIQUE INDEX uq_alert_events_idem
  ON alert_events (organization_id, idempotency_key, created_at);
CREATE INDEX idx_alert_events_fingerprint
  ON alert_events (organization_id, fingerprint, created_at DESC);
CREATE INDEX idx_alert_events_scope
  ON alert_events (organization_id, project_id, environment, created_at DESC);
CREATE INDEX idx_alert_events_occurred_brin ON alert_events USING BRIN (occurred_at);
```

```sql
CREATE TYPE alert_state AS ENUM
  ('pending','firing','acknowledged','resolved','suppressed','silenced','expired','error');

CREATE TABLE alert_event_state (
  alert_key                 VARCHAR(255) PRIMARY KEY,   -- org:fingerprint
  organization_id           UUID NOT NULL,
  project_id                UUID,
  latest_event_id           UUID NOT NULL,
  state                     alert_state NOT NULL,
  severity                  logdb_severity NOT NULL,
  duplicate_count           INTEGER NOT NULL DEFAULT 0,
  first_seen_at             TIMESTAMPTZ NOT NULL,
  last_seen_at              TIMESTAMPTZ NOT NULL,
  last_notified_at          TIMESTAMPTZ,
  acknowledged_by           UUID,
  acknowledged_at           TIMESTAMPTZ,
  acknowledgment_expires_at TIMESTAMPTZ,
  resolved_at               TIMESTAMPTZ,
  resolution_reason         VARCHAR(100),
  auto_resolve_at           TIMESTAMPTZ,
  escalation_policy_id      UUID,
  escalation_step_number    INTEGER NOT NULL DEFAULT 0,
  escalation_repeat_count   INTEGER NOT NULL DEFAULT 0,
  next_escalation_at        TIMESTAMPTZ,
  incident_id               UUID,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_alert_state_active
  ON alert_event_state (organization_id, state, last_seen_at DESC)
  WHERE state IN ('pending','firing','acknowledged');
CREATE INDEX idx_alert_state_escalation
  ON alert_event_state (next_escalation_at)
  WHERE state = 'firing' AND next_escalation_at IS NOT NULL;
CREATE INDEX idx_alert_state_autoresolve
  ON alert_event_state (auto_resolve_at)
  WHERE state = 'firing' AND auto_resolve_at IS NOT NULL;
CREATE TRIGGER trg_alert_event_state_updated_at
  BEFORE UPDATE ON alert_event_state
  FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();
```

`alert_event_history`, `alert_acknowledgments`, `alert_rule_executions`, `alert_metrics`,
`alert_dead_letter_events` keep their names (no API break) but become typed, append-only,
monthly-partitioned tables with real columns instead of the shared generic column set.

### `alert_notification_jobs` (LOGDB) — the contract handed to transport

```sql
CREATE TYPE notification_job_status AS ENUM
  ('pending','queued','sent','failed','suppressed','cancelled','expired');
CREATE TYPE notification_channel_kind AS ENUM
  ('in_app','email','slack','discord','teams','pagerduty','webhook','sms');

CREATE TABLE alert_notification_jobs (
  id                  UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL,
  project_id          UUID,
  alert_event_id      UUID NOT NULL,
  alert_key           VARCHAR(255) NOT NULL,
  channel_kind        notification_channel_kind NOT NULL,
  connector_id        UUID,                 -- resolved transport; NULL = managed/in-app
  route_id            UUID,
  recipient_user_id   UUID,
  recipient_ref       VARCHAR(320),         -- email/phone/channel handle (already resolved)
  template_id         UUID,
  severity            logdb_severity NOT NULL,
  priority            SMALLINT NOT NULL DEFAULT 0,
  escalation_step     SMALLINT NOT NULL DEFAULT 0,
  attempt_epoch       SMALLINT NOT NULL DEFAULT 0,  -- bumped only by manual re-send
  payload             JSONB NOT NULL,
  idempotency_key     VARCHAR(255) NOT NULL,
  status              notification_job_status NOT NULL DEFAULT 'pending',
  billable            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- zero duplicate notifications (success criterion)
CREATE UNIQUE INDEX uq_notification_job_idem
  ON alert_notification_jobs (organization_id, idempotency_key, created_at);
CREATE INDEX idx_notification_jobs_alert
  ON alert_notification_jobs (alert_event_id, created_at DESC);
```

`idempotency_key = sha256(alert_key : channel_kind : recipient_ref : escalation_step : attempt_epoch)`.
Because the router and connector both key off it, a redelivered pg-boss job cannot double-notify.

### `alert_notification_ledger` (LOGDB) — replaces `alert_throttle_windows`

```sql
CREATE TABLE alert_notification_ledger (
  id                  UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL,
  rule_id             UUID,
  rule_action_id      UUID,
  binding_id          UUID,
  alert_key           VARCHAR(255) NOT NULL,
  channel_kind        notification_channel_kind NOT NULL,
  recipient_user_id   UUID,
  notified_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, notified_at)
) PARTITION BY RANGE (notified_at);

CREATE INDEX idx_ledger_action_window
  ON alert_notification_ledger (rule_action_id, notified_at DESC);
CREATE INDEX idx_ledger_alert_window
  ON alert_notification_ledger (alert_key, notified_at DESC);
```

Throttle checks become `count(*) WHERE rule_action_id = $1 AND notified_at > now() - interval` and
`max(notified_at)` for min-interval — append-only, no upsert contention, no dual schema. The BRIN +
btree pair keeps this cheap.

---

## 4. Transactional outbox (LOGDB) — Phase 6

Lives in Log DB because it must commit in the **same transaction** as the `events_*` insert. pg-boss
lives in the primary DB, so a relay bridges them (ADR-0003).

```sql
CREATE TABLE telemetry_outbox (
  id               BIGSERIAL,
  organization_id  UUID NOT NULL,
  project_id       UUID,
  environment      VARCHAR(64),
  signal_kind      VARCHAR(32) NOT NULL,   -- error|cron_checkin|log|request|metric|message
  event_id         TEXT NOT NULL,
  severity         logdb_severity,
  fast_path        BOOLEAN NOT NULL DEFAULT FALSE,
  attributes       JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at      TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at       TIMESTAMPTZ,
  claimed_by       VARCHAR(128),
  published_at     TIMESTAMPTZ,
  attempts         SMALLINT NOT NULL DEFAULT 0,
  last_error       TEXT,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE UNIQUE INDEX uq_telemetry_outbox_idem
  ON telemetry_outbox (organization_id, signal_kind, event_id, created_at);
CREATE INDEX idx_telemetry_outbox_unpublished
  ON telemetry_outbox (fast_path DESC, created_at)
  WHERE published_at IS NULL;
```

Partitioned tables require the PK to include the partition key, hence `(id, created_at)`.

Relay contract: claim with `FOR UPDATE SKIP LOCKED`, publish to pg-boss, then set `published_at`.
Crash between publish and mark ⇒ at-least-once, absorbed by `uq_alert_events_idem`. Only rows with
`fast_path = TRUE` (error, cron failure, crash, security, auth failure, heartbeat loss) are relayed
individually; everything else is aggregated into per-(org, project, signal) tick hints so a
million-event day does not create a million alert jobs.

---

## 5. Channels, not connectors (Phase 9) — PRIMARY

```sql
CREATE TABLE alert_channel_bindings (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id              UUID REFERENCES projects(id) ON DELETE CASCADE,
  channel_kind            notification_channel_kind NOT NULL,
  connector_id            UUID REFERENCES connector_configs(id) ON DELETE SET NULL,
  use_managed_fallback    BOOLEAN NOT NULL DEFAULT FALSE,  -- Pulse managed SMTP
  fallback_channel_kind   notification_channel_kind,
  priority                INTEGER NOT NULL DEFAULT 100,
  enabled                 BOOLEAN NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_channel_binding_scope
  ON alert_channel_bindings (organization_id, project_id, channel_kind, connector_id)
  NULLS NOT DISTINCT WHERE deleted_at IS NULL;
CREATE INDEX idx_channel_bindings_resolve
  ON alert_channel_bindings (organization_id, channel_kind, priority DESC)
  WHERE deleted_at IS NULL AND enabled;
```

`notification_channel_kind` is created in **both** databases (same name, same order) so payloads
translate 1:1 without a mapping table.

## 6. Preferences additions (PRIMARY) — Phase 13

Existing project/member/subscription preferences (quiet hours, digest mode, severity threshold,
categories) are preserved. Missing pieces are added:

```sql
CREATE TABLE user_notification_preferences (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id       UUID REFERENCES organizations(id) ON DELETE CASCADE,
  min_severity          alert_severity NOT NULL DEFAULT 'warning',
  digest_mode           VARCHAR(30) NOT NULL DEFAULT 'immediate',
  quiet_hours           JSONB NOT NULL DEFAULT '{}'::jsonb,
  timezone              VARCHAR(64),
  vacation_until        TIMESTAMPTZ,
  muted_until           TIMESTAMPTZ,
  channel_preferences   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_notification_pref UNIQUE (user_id, organization_id)
);

CREATE TABLE alert_maintenance_windows (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id        UUID REFERENCES projects(id) ON DELETE CASCADE,
  environment       VARCHAR(64),
  name              VARCHAR(255) NOT NULL,
  behaviour         VARCHAR(16) NOT NULL DEFAULT 'suppress',  -- suppress|delay|allow
  starts_at         TIMESTAMPTZ NOT NULL,
  ends_at           TIMESTAMPTZ NOT NULL,
  rrule             VARCHAR(255),           -- recurring windows
  timezone          VARCHAR(64) NOT NULL DEFAULT 'UTC',
  matchers          JSONB NOT NULL DEFAULT '{}'::jsonb,
  max_severity_allowed alert_severity,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_by        UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_maintenance_duration CHECK (ends_at > starts_at)
);
CREATE INDEX idx_maintenance_active
  ON alert_maintenance_windows (organization_id, is_active, starts_at, ends_at)
  WHERE is_active;
```

`alert_silences` is kept as-is (ad-hoc, one-shot silences created from an event). Recurring/scheduled
mutes go to `alert_maintenance_windows`. Both are read by the Policy Engine's Maintenance Policy.

## 7. Usage accounting (Phase 11) — LOGDB ledger + PRIMARY rollup

```sql
CREATE TYPE alert_usage_kind AS ENUM (
  'alert_generated','alert_suppressed','alert_delivered','alert_failed',
  'connector_send','email_sent','slack_message','sms_sent','webhook_call',
  'discord_message','teams_message','pagerduty_event','delivery_retry'
);

CREATE TABLE alert_usage_events (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL,
  project_id        UUID,
  kind              alert_usage_kind NOT NULL,
  channel_kind      notification_channel_kind,
  alert_event_id    UUID,
  notification_job_id UUID,
  quantity          INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  billable          BOOLEAN NOT NULL,
  idempotency_key   VARCHAR(255) NOT NULL,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE UNIQUE INDEX uq_alert_usage_idem
  ON alert_usage_events (organization_id, idempotency_key, occurred_at);
CREATE INDEX idx_alert_usage_rollup
  ON alert_usage_events (organization_id, kind, occurred_at)
  WHERE billable;
```

Rollup: `alert.usage-rollup` aggregates billable rows into the **existing** `usage_counter_staging`
(counter types `billing:alerts:*`), which the established `flush_usage_counters()` /
`increment_event_usage()` path already drains. Reusing that machinery preserves the atomic,
transactional guarantee the audit confirmed for ingestion. `alert_suppressed` is always
`billable = false` (never charged, per requirement).

## 8. Correlation and incidents (Phase 14) — LOGDB

```sql
CREATE TABLE alert_correlation_groups (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL,
  project_id        UUID,
  correlation_key   VARCHAR(255) NOT NULL,
  strategy          VARCHAR(40) NOT NULL,  -- fingerprint|group_key|service_window|composite|ai
  member_count      INTEGER NOT NULL DEFAULT 0,
  root_alert_key    VARCHAR(255),
  opened_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE UNIQUE INDEX uq_correlation_open
  ON alert_correlation_groups (organization_id, correlation_key, created_at)
  WHERE closed_at IS NULL;

CREATE TABLE alert_incidents (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL,
  project_id        UUID,
  correlation_id    UUID,
  title             VARCHAR(500) NOT NULL,
  severity          logdb_severity NOT NULL,
  status            VARCHAR(30) NOT NULL DEFAULT 'open',
  priority          SMALLINT NOT NULL DEFAULT 0,
  root_cause_hint   JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_priority_score NUMERIC(6,3),
  opened_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at   TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
```

## 9. Global connector guards (PRIMARY) — fixes C4/C5

```sql
CREATE TABLE connector_rate_buckets (
  connector_id    UUID PRIMARY KEY REFERENCES connector_configs(id) ON DELETE CASCADE,
  window_start    TIMESTAMPTZ NOT NULL,
  window_seconds  INTEGER NOT NULL,
  consumed        INTEGER NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE connector_circuit_state (
  connector_id        UUID PRIMARY KEY REFERENCES connector_configs(id) ON DELETE CASCADE,
  state               VARCHAR(12) NOT NULL DEFAULT 'closed',  -- closed|open|half_open
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  opened_at           TIMESTAMPTZ,
  half_open_at        TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Atomic global token consumption in one statement (no Redis, no read-modify-write race):

```sql
INSERT INTO connector_rate_buckets (connector_id, window_start, window_seconds, consumed)
VALUES ($1, date_trunc('second', now()), $2, 1)
ON CONFLICT (connector_id) DO UPDATE
SET consumed = CASE
      WHEN connector_rate_buckets.window_start + ($2 || ' seconds')::interval <= now() THEN 1
      ELSE connector_rate_buckets.consumed + 1 END,
    window_start = CASE
      WHEN connector_rate_buckets.window_start + ($2 || ' seconds')::interval <= now()
      THEN date_trunc('second', now()) ELSE connector_rate_buckets.window_start END,
    updated_at = now()
RETURNING consumed <= $3 AS allowed, window_start;
```

The in-process limiter in `runtime.ts` is retained as a **pre-filter only** (cheap local shed) with the
DB bucket as the authority.

## 10. Connector runtime, typed (LOGDB)

`connector_deliveries` keeps the rich shape the code already expects (`correlation_id`, `attempts`,
`max_attempts`, `next_retry_at`, `sent_at`, `failed_at`, `payload`, `response_*`) but moves to Log DB
with monthly partitions and gains:

```sql
ALTER TABLE connector_deliveries
  ADD COLUMN notification_job_id UUID,          -- joins runtime truth back to the alert
  ADD COLUMN channel_kind notification_channel_kind,
  ADD COLUMN idempotency_key VARCHAR(255);
CREATE UNIQUE INDEX uq_connector_delivery_idem
  ON connector_deliveries (connector_id, idempotency_key, created_at);
```

`connector_delivery_attempts` gains the missing `delivery_id`/`delivery_created_at` pair (fixes A5).
`connector_dead_letters` is a real table (fixes C6):

```sql
CREATE TABLE connector_dead_letters (
  id                  UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL,
  connector_id        UUID,
  delivery_id         UUID,
  notification_job_id UUID,
  channel_kind        notification_channel_kind,
  failure_category    VARCHAR(64) NOT NULL,
  failure_reason      TEXT NOT NULL,
  attempts            INTEGER NOT NULL DEFAULT 0,
  payload             JSONB NOT NULL,
  status              VARCHAR(24) NOT NULL DEFAULT 'pending_retry',
  replayed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX idx_connector_dlq_status ON connector_dead_letters (status, created_at DESC);
```

## 11. Partition management

One `alert.partition-maintenance` job owns every partitioned table in both databases: it pre-creates
the next two months, verifies a DEFAULT partition exists, and detaches+drops partitions past the
org's plan retention. This closes audit finding C2 for telemetry, alert runtime, connector runtime,
outbox, usage, and correlation tables in a single place.

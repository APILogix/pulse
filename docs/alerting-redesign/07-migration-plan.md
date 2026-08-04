# Phase 16 — Database Migration Plan

Rules: **no data destruction**, rolling deployment safe, rollback safe, zero downtime. Every migration
is additive first; destructive steps happen only in a later, separately deployed release after
verification.

## 1. Migration ordering

### Primary DB — `src/db/postgres/canonical_migrations_draft/`

File numbers below were corrected against the repository's actual migration trees — see
`DEVIATIONS.md` DEV-001. Numbering only; ordering semantics and DDL are unchanged.

| # | File | Type | Reversible |
|---|---|---|---|
| P1 | `08_alerting/019_create_alert_scope_types.up.sql` | new enums (`alert_scope_type`, `alert_binding_mode`, `alert_action_merge_mode`, `notification_channel_kind`) | yes (DROP TYPE) |
| P2 | `08_alerting/020_create_alert_rule_bindings.up.sql` | new table + indexes + trigger | yes |
| P3 | `08_alerting/021_create_alert_rule_revisions.up.sql` | new table; `alert_rules.current_revision` | yes |
| P4 | `08_alerting/022_create_alert_channel_bindings.up.sql` | new table | yes |
| P5 | `08_alerting/023_create_alert_maintenance_windows.up.sql` | new table | yes |
| P6 | `08_alerting/024_add_config_version.up.sql` | `organizations.config_version` + bump triggers on config tables | yes |
| P7 | `06_connectors/015_create_connector_runtime_guards.up.sql` | `connector_rate_buckets`, `connector_circuit_state` | yes |
| P8 | `04_projects/027_create_user_notification_preferences.up.sql` | new table | yes |
| P9 | `11_billing/seeder/028c5_seed_billing_features_alerting_v2.sql` | new feature keys (idempotent upsert) | yes (delete by key) |
| P10 | `11_billing/seeder/030e_seed_plan_entitlements_alerting_v2.sql` | plan values | yes |
| P11 | `11_billing/031_add_alert_usage_columns.up.sql` (number to re-verify) | new counter columns (`DEFAULT 0 NOT NULL`) | yes |
| P12 | `08_alerting/025_backfill_rule_bindings.up.sql` | **data backfill** (idempotent) | yes (delete backfilled rows by marker) |
| P13 | `08_alerting/026_backfill_channel_bindings.up.sql` | **data backfill** from `alert_rule_actions.connector_id` | yes |
| P14 | `08_alerting/027_backfill_threshold_bindings.up.sql` | **data backfill** from `project_alert_thresholds` | yes |
| P15 *(release N+2)* | `08_alerting/028_deprecate_legacy_columns.up.sql` | mark `alert_rules.project_id`, `alert_rule_actions.connector_id/route_id` deprecated (comment only, still nullable) | yes |
| P16 *(release N+3)* | `08_alerting/029_drop_legacy_alert_runtime.up.sql` | drop control-plane runtime copies | **no** — gated on verification |

### Log DB — `database/migrations/logdb/`

| # | File | Type | Reversible |
|---|---|---|---|
| L1 | `00_shared/002_alerting_v2_types.up.sql` | `notification_channel_kind`, `alert_event_kind`, `alert_state`, `notification_job_status`, `alert_usage_kind` | yes |
| L2 | `07_outbox/001_telemetry_outbox.up.sql` | outbox table + partitions | yes |
| L3 | `06_alert_runtime/002_alert_runtime_v2.up.sql` | typed `alert_events_v2`, `alert_event_state`, `alert_event_history_v2`, `alert_rule_eval_state`, `alert_notification_jobs`, `alert_notification_ledger`, `alert_delivery_attempts_v2`, `alert_metrics_v2`, `alert_acknowledgments_v2`, `alert_dead_letter_events_v2` | yes |
| L4 | `06_alert_runtime/003_alert_usage_events.up.sql` | usage ledger | yes |
| L5 | `06_alert_runtime/004_alert_correlation.up.sql` | correlation groups + incidents | yes |
| L6 | `05_connectors_runtime/002_connector_runtime_v2.up.sql` | typed `connector_deliveries_v2`, `connector_delivery_attempts_v2`, `connector_health_checks_v2`, `connector_test_runs_v2`, `connector_audit_logs_v2`, `connector_dead_letters` | yes |
| L7 | `08_partitions/001_partition_manager.up.sql` | partition helper functions | yes |
| L8 | `06_alert_runtime/005_backfill_runtime_v2.up.sql` | **copy-forward backfill** from generic tables (batched) | yes (truncate v2) |
| L9 *(release N+2)* | `06_alert_runtime/006_swap_views.up.sql` | rename v2 → canonical, old → `_legacy`, create compatibility views | yes (rename back) |
| L10 *(release N+3)* | `06_alert_runtime/007_drop_legacy_runtime.up.sql` | drop `_legacy` tables | **no** — gated |

## 2. The `_v2` + view-swap strategy (why)

The audit found the same table name defined with two incompatible schemas. An in-place `ALTER` cannot
be rolling-safe: old and new code would need different column sets simultaneously. So:

1. **Release N** — create `*_v2` tables. New code writes v2 **and** reads v2. Old code untouched,
   still reading/writing the legacy tables. Backfill copies legacy → v2 in batches.
2. **Release N+1** — dual-read verification: a comparison job asserts row counts and sampled content
   match between legacy and v2 for a full retention window. Feature flag
   `ALERTING_V2_READ=true|false` allows instant read fallback without redeploy.
3. **Release N+2** — swap names. `alert_events` becomes a **view** over `alert_events_v2` for any
   remaining reader, so no query breaks. Legacy tables renamed `*_legacy`.
4. **Release N+3** — drop `*_legacy` after a full retention period has elapsed and metrics confirm no
   reads.

Every step is independently deployable and each has an inverse.

## 3. Backfill: rule bindings (P12) — idempotent, non-destructive

```sql
-- Every existing rule gets an explicit organization binding preserving current behaviour.
INSERT INTO alert_rule_bindings
  (organization_id, rule_id, scope_type, scope_level, mode, enabled, severity,
   cooldown_seconds, deduplication_window_seconds, auto_resolve_after_minutes,
   evaluation_interval_seconds, created_by, notes)
SELECT r.organization_id, r.id, 'organization', 0, 'inherit', r.enabled, r.severity,
       r.cooldown_seconds, r.deduplication_window_seconds, r.auto_resolve_after_minutes,
       r.evaluation_interval_seconds, r.created_by, 'backfill:v2'
FROM alert_rules r
WHERE r.deleted_at IS NULL
  AND r.project_id IS NULL
ON CONFLICT DO NOTHING;

-- Project-scoped rules become a project binding on the same rule.
INSERT INTO alert_rule_bindings
  (organization_id, rule_id, scope_type, scope_level, project_id, mode, enabled, severity,
   cooldown_seconds, deduplication_window_seconds, auto_resolve_after_minutes,
   evaluation_interval_seconds, created_by, notes)
SELECT r.organization_id, r.id, 'project', 1, r.project_id, 'override', r.enabled, r.severity,
       r.cooldown_seconds, r.deduplication_window_seconds, r.auto_resolve_after_minutes,
       r.evaluation_interval_seconds, r.created_by, 'backfill:v2'
FROM alert_rules r
WHERE r.deleted_at IS NULL
  AND r.project_id IS NOT NULL
ON CONFLICT DO NOTHING;
```

Behaviour equivalence: an org rule with a single `organization/inherit` binding resolves to exactly
what it does today. A project rule resolves to exactly its current single-project scope. **No customer
sees a behaviour change from the backfill** — inheritance only takes effect when someone creates a new
binding. This is the property that makes the redesign safe to ship.

Rollback: `DELETE FROM alert_rule_bindings WHERE notes = 'backfill:v2';`

## 4. Backfill: channel bindings (P13)

```sql
INSERT INTO alert_channel_bindings
  (organization_id, project_id, channel_kind, connector_id, priority, enabled)
SELECT DISTINCT c.organization_id, NULL,
       (CASE c.provider
          WHEN 'email' THEN 'email' WHEN 'slack' THEN 'slack'
          WHEN 'discord' THEN 'discord' WHEN 'teams' THEN 'teams'
          WHEN 'pagerduty' THEN 'pagerduty' WHEN 'webhook' THEN 'webhook'
          WHEN 'sms' THEN 'sms' END)::notification_channel_kind,
       c.id, 100, c.status = 'active'
FROM connector_configs c
WHERE c.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- Managed SMTP fallback for orgs with no email connector (fixes audit D6).
INSERT INTO alert_channel_bindings
  (organization_id, channel_kind, connector_id, use_managed_fallback, priority, enabled)
SELECT o.id, 'email', NULL, TRUE, 200, TRUE
FROM organizations o
WHERE o.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM connector_configs c
    WHERE c.organization_id = o.id AND c.provider = 'email' AND c.deleted_at IS NULL)
ON CONFLICT DO NOTHING;
```

Every existing `alert_rule_actions.connector_id` is preserved; the derived `requested_channels` on the
rule's binding is computed from the connector's provider so current delivery targets are unchanged.

## 5. Backfill: thresholds → bindings (P14)

For each `project_alert_thresholds` row, upsert the mapped preset rule for the org (if absent) and
create a binding at project or environment scope:

```sql
INSERT INTO alert_rule_bindings
  (organization_id, rule_id, scope_type, scope_level, project_id, environment,
   mode, enabled, severity, cooldown_seconds, consecutive_breaches,
   threshold_overrides, created_by, notes)
SELECT t.organization_id, m.rule_id,
       CASE WHEN t.environment_id IS NULL THEN 'project' ELSE 'environment' END,
       CASE WHEN t.environment_id IS NULL THEN 1 ELSE 2 END,
       t.project_id, e.slug,
       CASE WHEN t.enabled THEN 'override' ELSE 'disable' END,
       t.enabled, t.severity::alert_severity, t.cooldown_minutes * 60, t.consecutive_breaches,
       jsonb_build_object(m.field_path, t.threshold_value), t.created_by, 'backfill:threshold'
FROM project_alert_thresholds t
JOIN alert_threshold_preset_map m ON m.threshold_key = t.threshold_key
LEFT JOIN project_environments e ON e.id = t.environment_id
WHERE t.deleted_at IS NULL
ON CONFLICT DO NOTHING;
```

`alert_threshold_preset_map` is a small seeded lookup shipped in the same migration. The source table
is **left intact and readable**; `ProjectThresholdWorker` keeps running until release N+2 with a
flag (`PROJECT_THRESHOLD_WORKER_ENABLED`) so both engines can be compared side by side, then the old
worker is disabled. Double-firing during overlap is prevented because migrated bindings carry
`fingerprint = project-threshold:<id>` compatibility, so the Decision Engine dedups them against the
old worker's events.

## 6. Runtime backfill (L8) — batched, resumable, online

```sql
-- run in a loop until 0 rows; safe to re-run
WITH batch AS (
  SELECT * FROM alert_events_legacy
  WHERE created_at >= $1 AND created_at < $2
  ORDER BY occurred_at
  LIMIT 5000
)
INSERT INTO alert_events_v2 (id, organization_id, project_id, environment, rule_id, kind, severity,
       fingerprint, dedup_key, source, engine, idempotency_key, evidence, labels, annotations,
       occurred_at, created_at)
SELECT b.id, b.organization_id, b.project_id, b.environment, b.rule_id,
       COALESCE(NULLIF(b.status,'')::alert_event_kind, 'fired'),
       COALESCE(b.severity,'info'), COALESCE(b.payload->>'fingerprint', b.id::text),
       COALESCE(b.payload->>'fingerprint', b.id::text), COALESCE(b.payload->>'source','legacy'),
       'legacy', 'legacy:' || b.id::text, COALESCE(b.payload,'{}'::jsonb), '{}'::jsonb, '{}'::jsonb,
       b.occurred_at, b.occurred_at
FROM batch b
ON CONFLICT DO NOTHING;
```

Runs as `alert.migrate-runtime` pg-boss job, month-partition by month-partition, throttled, with a
checkpoint table so a restart resumes. No locks on hot tables (append-only inserts to a new table).

## 7. Zero-downtime deployment sequence

```text
Step 1  Apply P1–P11, L1–L7        (additive DDL only; old code unaffected)
Step 2  Deploy API + workers (v2 code, flags OFF: writes legacy, reads legacy)
Step 3  Run P12–P14, L8 backfills   (idempotent, resumable)
Step 4  Flag ALERTING_V2_WRITE=true (dual-write: legacy + v2)
Step 5  Verify comparison job for one full retention window
Step 6  Flag ALERTING_V2_READ=true  (read v2; legacy still written)
Step 7  Flag OUTBOX_ENABLED=true    (fast engine goes live; scheduled evaluator becomes reconcile)
Step 8  Flag PROJECT_THRESHOLD_WORKER_ENABLED=false
Step 9  Release N+2: L9 view swap, P15
Step 10 Release N+3: P16, L10 drops
```

Flags are environment variables read at worker boot, so a rollback is a restart, not a migration.

## 8. Rollback matrix

| Failure at step | Rollback action | Data loss |
|---|---|---|
| 1 (DDL) | run `.down.sql` for the applied files | none |
| 2 (deploy) | redeploy previous image | none |
| 3 (backfill) | `DELETE … WHERE notes LIKE 'backfill:%'` / `TRUNCATE *_v2` | none (sources intact) |
| 4 (dual-write) | flag off; legacy remains authoritative | v2 rows orphaned, harmless |
| 6 (v2 read) | `ALERTING_V2_READ=false` | none (legacy still written) |
| 7 (outbox/fast engine) | `OUTBOX_ENABLED=false`; reconcile evaluator covers the gap | possible duplicate alerts during flip, absorbed by dedup |
| 8 (threshold worker off) | re-enable flag | none |
| 9 (view swap) | rename back | none |
| 10 (drops) | restore from backup only | **irreversible — requires sign-off** |

## 9. Verification gates (must pass before advancing)

1. `alert_events_v2` count == legacy count for every closed partition.
2. Sampled 1 000 rows byte-compare on fingerprint, severity, occurred_at.
3. No `alert_notification_jobs` without a matching `alert_events_v2` row.
4. No `alert_usage_events` where `kind='alert_generated'` and the alert is `suppressed`/`duplicate`.
5. `connector_deliveries_v2` terminal states reconcile 1:1 with `alert_notification_jobs` statuses.
6. Policy Engine shadow-mode diff: for 24h, resolve policies for live candidates and assert the
   resolved connector set equals what the legacy batch processor chose. Any diff blocks step 6.

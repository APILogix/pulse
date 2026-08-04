# ADR-0005 — Unified Effective Threshold Resolution (thresholds become a rule layer)

Status: Proposed · Date: 2026-07-31 · Related: ADR-0004

## Context

Two independent threshold systems exist:

1. `alert_rules` + `alert_rule_conditions`, evaluated by `AlertRuleEvaluator` against `events_*`.
2. `project_alert_thresholds` (13 seeded keys per project, nullable `environment_id`), evaluated by
   `ProjectThresholdWorker` against `project_usage_minute`, `events_requests`, and `ai_usage_logs`.

Both run in the same tick and both call `EventsService.ingestEvent`.

## Problem

1. Two engines, two schemas, two vocabularies for the same concept ("error rate > 5%").
2. `findEnabled` returns project-wide **and** environment rows and evaluates each independently, so a
   project-wide and an environment threshold for the same key **both fire**. That is duplicate
   evaluation, which the brief forbids.
3. Thresholds cannot inherit from the organization at all — there is no org-level threshold.
4. Two different cooldown/breach implementations (`cooldown_minutes` + `current_breaches` on the row
   vs `cooldown_seconds` + `metadata.consecutiveBreaches` JSONB on the rule).
5. Users must learn two mental models and two UIs for one job.

## Options Considered

| Option | Assessment |
|---|---|
| **A. Keep both, add precedence logic to the threshold worker** | Rejected. Leaves two engines, two schemas, and no org-level threshold; precedence would still not compose with rule-level inheritance. |
| **B. Keep both but make thresholds authoritative for project scope** | Rejected. Splits ownership by scope, so an org rule and a project threshold could still both fire, and rule actions/escalation would not apply to thresholds. |
| **C. Fold thresholds into the rule model as bindings + presets** | **Chosen.** |
| **D. Fold rules into the threshold model** | Rejected. The threshold model has no conditions/actions/routing/escalation and no composite support; it is the weaker abstraction. |

## Decision

A threshold is a **rule binding with a `threshold_overrides` value**. There is exactly one resolution
path and one engine.

- Each of the 13 threshold keys maps to a preset rule (`alert_threshold_preset_map`), several of which
  already exist (`high_error_rate`, `high_latency_p95`, `high_latency_p99`, `ai_cost_spike`,
  `traffic_spike`); the rest are added as new presets (`apdex_low`, `traffic_drop`,
  `failed_notification_rate`, `ingestion_error_rate`, `rate_limit_pressure`, `latency_percentile`).
- Resolution ladder becomes the single ADR-0004 ladder: organization → project → environment →
  service → endpoint, deepest-wins, one effective threshold.
- All metric SQL from `ProjectThresholdWorker` is preserved verbatim in the Window Engine's metric
  registry, including the `project_usage_minute` reads and the deliberate exclusion of
  non-composable latency percentiles from additive rollups (those keep reading `events_requests`).
- Breach/cooldown state unifies into `alert_rule_eval_state` keyed by
  `sha256(rule_id : binding_id : scope tuple)`, replacing both the row columns and the
  `alert_rules.metadata` JSONB write (which was also a hot-row write on a config table).

## Consequences

Positive: one engine, one schema, one vocabulary; org-level thresholds become possible for the first
time; thresholds inherit actions, routing, escalation, templates, and correlation for free; duplicate
project/environment firing is eliminated by construction; config tables stop being written every tick.

Negative: a real data migration with a mapping table; during overlap two workers could produce the
same alert (mitigated: migrated bindings keep the `project-threshold:<id>` fingerprint so the Decision
Engine dedups them); the 13 seeded keys must be preset-mapped exactly or a customer silently loses a
threshold — hence the verification gate.

## Migration Impact

`project_alert_thresholds` is **not dropped**. It is backfilled into bindings (P14), and
`ProjectThresholdWorker` keeps running behind `PROJECT_THRESHOLD_WORKER_ENABLED=true` so both engines
can be compared. Cutover disables the flag; rollback re-enables it. Values map as
`threshold_value → threshold_overrides[field_path]`, `cooldown_minutes*60 → cooldown_seconds`,
`consecutive_breaches → consecutive_breaches`, `evaluation_window_minutes → lookback_minutes`,
`enabled = false → mode = 'disable'`, `environment_id → environment` slug.

## Future Considerations

- Per-endpoint SLO thresholds with burn-rate windows (multi-window, multi-burn-rate) fit naturally as
  a new condition type once endpoint scope exists.
- Dynamic/baseline thresholds become a `condition_type = 'anomaly'` implementation that consumes the
  same binding overrides for sensitivity instead of absolute values.
- `project_alert_thresholds` can be dropped one release after the UI stops reading it.

/**
 * Policy-layer metrics.
 *
 * Architecture: docs/alerting-redesign/08-implementation-plan.md Increment 2 ("Ops")
 *
 * `alert_binding_conflicts_total` fires when two bindings tie at the same scope depth and
 * the ADR-0004 §5 tie-break had to decide. Resolution stays deterministic either way, but a
 * tie almost always means a misconfiguration the operator wants to know about.
 *
 * Labelled by scope level only (bounded 0–4). Organization id is deliberately NOT a label:
 * it would make cardinality grow with tenant count.
 */
import promClient from 'prom-client';
import { register } from '../../../config/metrics.js';

const BINDING_CONFLICTS_METRIC = 'alert_binding_conflicts_total';

/** Idempotent accessor — the module may be imported by several processes and by tests. */
function bindingConflictsCounter(): promClient.Counter<string> {
  const existing = register.getSingleMetric(BINDING_CONFLICTS_METRIC);
  if (existing) return existing as promClient.Counter<string>;
  return new promClient.Counter({
    name: BINDING_CONFLICTS_METRIC,
    help:
      'Times two alert rule bindings tied at the same scope depth during effective rule '
      + 'resolution and the tie-break decided the outcome.',
    labelNames: ['scope_level'],
    registers: [register],
  });
}

/** Record an equal-depth binding conflict at the given scope level. */
export function recordBindingConflict(scopeLevel: number): void {
  bindingConflictsCounter().inc({ scope_level: String(scopeLevel) });
}

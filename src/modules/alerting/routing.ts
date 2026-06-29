/**
 * Routing rule matching (pure).
 *
 * Given an alert's attributes (severity, source, labels) and the org's ordered
 * routing rules, select the connectors to deliver to. Rules are evaluated in
 * priority order (highest first); the first matching active rule wins. Its
 * target connectors are used; if those are empty its fallback connectors are
 * used instead.
 */
import type { AlertSeverity, AlertRoutingRuleRow, RoutingConditions } from './types.js';

export interface RoutableAlert {
  severity: AlertSeverity;
  source: string;
  labels: Record<string, unknown>;
}

export interface RoutingDecision {
  matchedRuleId: string | null;
  connectorIds: string[];
  routeIds: string[];
  usedFallback: boolean;
  templateId: string | null;
}

/** Whether an alert satisfies a routing rule's conditions (all present clauses must match). */
export function matchesConditions(alert: RoutableAlert, conditions: RoutingConditions): boolean {
  if (conditions.severity && conditions.severity.length > 0 && !conditions.severity.includes(alert.severity)) {
    return false;
  }
  if (conditions.source && conditions.source.length > 0 && !conditions.source.includes(alert.source)) {
    return false;
  }
  if (conditions.labels) {
    for (const [k, v] of Object.entries(conditions.labels)) {
      if (String(alert.labels[k] ?? '') !== String(v)) return false;
    }
  }
  return true;
}

/**
 * Resolve the routing decision for an alert. Rules are sorted by priority DESC;
 * the first active rule whose conditions match is selected.
 */
export function resolveRouting(alert: RoutableAlert, rules: AlertRoutingRuleRow[]): RoutingDecision {
  const ordered = rules
    .filter((r) => r.is_active && r.deleted_at === null)
    .sort((a, b) => b.priority - a.priority);

  const match = ordered.find((r) => matchesConditions(alert, r.conditions));
  if (!match) {
    return { matchedRuleId: null, connectorIds: [], routeIds: [], usedFallback: false, templateId: null };
  }

  const primary = match.target_connector_ids ?? [];
  if (primary.length > 0) {
    return {
      matchedRuleId: match.id,
      connectorIds: primary,
      routeIds: match.target_route_ids ?? [],
      usedFallback: false,
      templateId: match.template_id,
    };
  }

  return {
    matchedRuleId: match.id,
    connectorIds: match.fallback_connector_ids ?? [],
    routeIds: match.target_route_ids ?? [],
    usedFallback: true,
    templateId: match.template_id,
  };
}

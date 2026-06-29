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
export declare function matchesConditions(alert: RoutableAlert, conditions: RoutingConditions): boolean;
/**
 * Resolve the routing decision for an alert. Rules are sorted by priority DESC;
 * the first active rule whose conditions match is selected.
 */
export declare function resolveRouting(alert: RoutableAlert, rules: AlertRoutingRuleRow[]): RoutingDecision;
//# sourceMappingURL=routing.d.ts.map
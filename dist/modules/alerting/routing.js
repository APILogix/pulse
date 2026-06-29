/** Whether an alert satisfies a routing rule's conditions (all present clauses must match). */
export function matchesConditions(alert, conditions) {
    if (conditions.severity && conditions.severity.length > 0 && !conditions.severity.includes(alert.severity)) {
        return false;
    }
    if (conditions.source && conditions.source.length > 0 && !conditions.source.includes(alert.source)) {
        return false;
    }
    if (conditions.labels) {
        for (const [k, v] of Object.entries(conditions.labels)) {
            if (String(alert.labels[k] ?? '') !== String(v))
                return false;
        }
    }
    return true;
}
/**
 * Resolve the routing decision for an alert. Rules are sorted by priority DESC;
 * the first active rule whose conditions match is selected.
 */
export function resolveRouting(alert, rules) {
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
//# sourceMappingURL=routing.js.map
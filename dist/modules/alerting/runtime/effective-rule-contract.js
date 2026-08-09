import { createHash } from 'node:crypto';
export function buildEffectiveProjectRule(rule, effective, scope) {
    if (!scope.projectId || !effective.enabled || !effective.bindingId)
        return null;
    const contract = {
        organizationId: rule.organization_id,
        projectId: scope.projectId,
        ruleId: rule.id,
        bindingId: effective.bindingId,
        ruleRevision: rule.current_revision,
        scope: {
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            environment: scope.environment ?? null,
            service: scope.service ?? null,
            endpoint: scope.endpoint ?? null,
        },
        enabled: effective.enabled,
        severity: effective.severity,
        cooldownSeconds: effective.cooldownSeconds,
        deduplicationWindowSeconds: effective.deduplicationWindowSeconds,
        evaluationIntervalSeconds: effective.evaluationIntervalSeconds,
        autoResolveAfterMinutes: effective.autoResolveAfterMinutes,
        consecutiveBreaches: effective.consecutiveBreaches,
        conditions: effective.conditions,
        requestedChannels: [...effective.requestedChannels].sort(),
        recipientOverrides: effective.recipientOverrides,
        escalationPolicyId: effective.escalationPolicyId,
    };
    return { ...contract, hash: hashCanonical(contract) };
}
export function hashCanonical(value) {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
function canonicalJson(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(',')}]`;
    const record = value;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
//# sourceMappingURL=effective-rule-contract.js.map
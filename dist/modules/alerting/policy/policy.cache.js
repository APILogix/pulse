import { LRUCache } from 'lru-cache';
export class AlertPolicyCache {
    cache = new LRUCache({ max: 5000, ttl: 30_000 });
    get(key) {
        const value = this.cache.get(key);
        return value ? cloneResult(value) : undefined;
    }
    set(key, value) {
        this.cache.set(key, cloneResult(value));
    }
    deleteByRule(ruleId) {
        for (const key of this.cache.keys()) {
            if (key.includes(`:${ruleId}:`))
                this.cache.delete(key);
        }
    }
    clear() {
        this.cache.clear();
    }
}
function cloneResult(value) {
    return structuredClone(value);
}
export function policyCacheKey(organizationId, ruleId, version, scope) {
    return [organizationId, ruleId, version, scope.projectId ?? '', scope.environment ?? '', scope.service ?? '', scope.endpoint ?? ''].join(':');
}
//# sourceMappingURL=policy.cache.js.map
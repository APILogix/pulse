import { LRUCache } from 'lru-cache';
export class AlertPolicyCache {
    cache = new LRUCache({ max: 5000, ttl: 30_000 });
    get(key) {
        return this.cache.get(key);
    }
    set(key, value) {
        this.cache.set(key, deepFreeze(value));
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
function deepFreeze(obj) {
    if (obj === null || typeof obj !== 'object' || Object.isFrozen(obj)) {
        return obj;
    }
    Object.freeze(obj);
    for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (val !== null && typeof val === 'object') {
            deepFreeze(val);
        }
    }
    return obj;
}
export function policyCacheKey(organizationId, ruleId, version, scope, options = {}) {
    return [organizationId, ruleId, version, options.requireProjectSubscription === true ? 'strict' : 'compat', scope.projectId ?? '', scope.environment ?? '', scope.service ?? '', scope.endpoint ?? ''].join(':');
}
//# sourceMappingURL=policy.cache.js.map
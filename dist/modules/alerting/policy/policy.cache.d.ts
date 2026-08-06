import type { PolicyResolutionResult } from './types.js';
export declare class AlertPolicyCache {
    private readonly cache;
    get(key: string): PolicyResolutionResult | undefined;
    set(key: string, value: PolicyResolutionResult): void;
    deleteByRule(ruleId: string): void;
    clear(): void;
}
export declare function policyCacheKey(organizationId: string, ruleId: string, version: number, scope: {
    projectId?: string | null;
    environment?: string | null;
    service?: string | null;
    endpoint?: string | null;
}): string;
//# sourceMappingURL=policy.cache.d.ts.map
import type { FastifyBaseLogger } from 'fastify';
import { EntitlementsRepository } from '../../billing/entitlements/repository.js';
export interface EntitlementDecision {
    allowed: boolean;
    reportOnly: boolean;
    reason: 'entitled' | 'not_entitled' | 'unknown_critical_allow' | 'unknown_noncritical_deny';
}
export declare class AlertEntitlementGuard {
    private readonly entitlements;
    private readonly log;
    constructor(logger: FastifyBaseLogger, entitlements?: EntitlementsRepository);
    check(organizationId: string, featureKey: string, severity: string, reportOnly?: boolean): Promise<EntitlementDecision>;
}
//# sourceMappingURL=guard.d.ts.map
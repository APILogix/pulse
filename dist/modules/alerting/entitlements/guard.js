import { EntitlementsRepository } from '../../billing/entitlements/repository.js';
export class AlertEntitlementGuard {
    entitlements;
    log;
    constructor(logger, entitlements = new EntitlementsRepository()) {
        this.entitlements = entitlements;
        this.log = logger.child({ component: 'alert-entitlement-guard' });
    }
    async check(organizationId, featureKey, severity, reportOnly = true) {
        try {
            const entitled = await this.entitlements.hasFeature(organizationId, featureKey);
            const decision = {
                allowed: entitled,
                reportOnly,
                reason: entitled ? 'entitled' : 'not_entitled',
            };
            if (!entitled)
                this.log.warn({ organizationId, featureKey, severity, reportOnly }, 'Alert entitlement denied');
            return reportOnly ? { ...decision, allowed: true } : decision;
        }
        catch (error) {
            const critical = severity === 'critical' || severity === 'fatal';
            const decision = {
                allowed: critical || reportOnly,
                reportOnly,
                reason: critical ? 'unknown_critical_allow' : 'unknown_noncritical_deny',
            };
            this.log.error({ error, organizationId, featureKey, severity, decision }, 'Alert entitlement lookup failed');
            return decision;
        }
    }
}
//# sourceMappingURL=guard.js.map
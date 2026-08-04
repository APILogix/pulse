import type { FastifyBaseLogger } from 'fastify';
import { EntitlementsRepository } from '../../billing/entitlements/repository.js';

export interface EntitlementDecision {
  allowed: boolean;
  reportOnly: boolean;
  reason: 'entitled' | 'not_entitled' | 'unknown_critical_allow' | 'unknown_noncritical_deny';
}

export class AlertEntitlementGuard {
  private readonly entitlements: EntitlementsRepository;
  private readonly log: FastifyBaseLogger;

  constructor(
    logger: FastifyBaseLogger,
    entitlements = new EntitlementsRepository(),
  ) {
    this.entitlements = entitlements;
    this.log = logger.child({ component: 'alert-entitlement-guard' });
  }

  async check(
    organizationId: string,
    featureKey: string,
    severity: string,
    reportOnly = true,
  ): Promise<EntitlementDecision> {
    try {
      const entitled = await this.entitlements.hasFeature(organizationId, featureKey);
      const decision: EntitlementDecision = {
        allowed: entitled,
        reportOnly,
        reason: entitled ? 'entitled' : 'not_entitled',
      };
      if (!entitled) this.log.warn({ organizationId, featureKey, severity, reportOnly }, 'Alert entitlement denied');
      return reportOnly ? { ...decision, allowed: true } : decision;
    } catch (error) {
      const critical = severity === 'critical' || severity === 'fatal';
      const decision: EntitlementDecision = {
        allowed: critical || reportOnly,
        reportOnly,
        reason: critical ? 'unknown_critical_allow' : 'unknown_noncritical_deny',
      };
      this.log.error({ error, organizationId, featureKey, severity, decision }, 'Alert entitlement lookup failed');
      return decision;
    }
  }
}

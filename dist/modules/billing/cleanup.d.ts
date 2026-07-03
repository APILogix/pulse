import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
export declare function runBillingUsageDailyRollup(db: Pool, log: FastifyBaseLogger): Promise<void>;
export declare function runBillingCouponExpiryCleanup(db: Pool, log: FastifyBaseLogger): Promise<void>;
export declare function runBillingTrialExpiryCheck(db: Pool, log: FastifyBaseLogger): Promise<void>;
export declare function runBillingUsageLimitWarningSweep(db: Pool, log: FastifyBaseLogger): Promise<void>;
export declare function runBillingSubscriptionRenewalReconciliation(db: Pool, log: FastifyBaseLogger): Promise<void>;
export declare function runBillingDunningRetry(db: Pool, log: FastifyBaseLogger): Promise<void>;
export declare function runBillingPlanLimitEnforcementSweep(db: Pool, log: FastifyBaseLogger): Promise<void>;
//# sourceMappingURL=cleanup.d.ts.map
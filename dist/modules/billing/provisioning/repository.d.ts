import type { PoolClient } from 'pg';
export interface BillingProvisioningResult {
    subscriptionId: string;
    planId: string;
    status: 'active' | 'trialing';
    featureCount: number;
    eventLimit: number;
    aiCreditLimit: number;
}
/** SQL boundary for the Billing-owned part of organization provisioning. */
export declare class BillingProvisioningRepository {
    provisionFreeSubscription(client: PoolClient, organizationId: string): Promise<BillingProvisioningResult>;
}
//# sourceMappingURL=repository.d.ts.map
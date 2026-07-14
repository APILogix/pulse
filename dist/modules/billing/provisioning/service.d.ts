import type { PoolClient } from 'pg';
import { BillingProvisioningRepository, type BillingProvisioningResult } from './repository.js';
/**
 * Billing's explicit boundary for initial organization commercial state.
 * The caller supplies its transaction so provisioning is all-or-nothing.
 */
export declare class BillingProvisioningService {
    private readonly repository;
    constructor(repository?: BillingProvisioningRepository);
    provisionFreeSubscription(client: PoolClient, organizationId: string): Promise<BillingProvisioningResult>;
}
//# sourceMappingURL=service.d.ts.map
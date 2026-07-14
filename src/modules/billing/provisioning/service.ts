import type { PoolClient } from 'pg';
import { BillingProvisioningRepository, type BillingProvisioningResult } from './repository.js';

/**
 * Billing's explicit boundary for initial organization commercial state.
 * The caller supplies its transaction so provisioning is all-or-nothing.
 */
export class BillingProvisioningService {
  constructor(private readonly repository = new BillingProvisioningRepository()) {}

  provisionFreeSubscription(
    client: PoolClient,
    organizationId: string,
  ): Promise<BillingProvisioningResult> {
    return this.repository.provisionFreeSubscription(client, organizationId);
  }
}

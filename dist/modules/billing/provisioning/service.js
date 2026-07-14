import { BillingProvisioningRepository } from './repository.js';
/**
 * Billing's explicit boundary for initial organization commercial state.
 * The caller supplies its transaction so provisioning is all-or-nothing.
 */
export class BillingProvisioningService {
    repository;
    constructor(repository = new BillingProvisioningRepository()) {
        this.repository = repository;
    }
    provisionFreeSubscription(client, organizationId) {
        return this.repository.provisionFreeSubscription(client, organizationId);
    }
}
//# sourceMappingURL=service.js.map
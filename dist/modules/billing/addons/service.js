import { BillingError, BillingErrorCodes } from '../shared/errors.js';
import { AddonsRepository } from './repository.js';
import { entitlementsService } from '../entitlements/service.js';
export class AddonsService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    async listAddons(query) {
        const { data, total } = await this.repository.listAddons(query);
        const offset = (query.page - 1) * query.limit;
        return { success: true, data, meta: { page: query.page, limit: query.limit, total, hasMore: offset + data.length < total } };
    }
    async listSubscriptionAddons(orgId) {
        return { success: true, data: await this.repository.listSubscriptionAddons(orgId) };
    }
    async subscribeAddon(orgId, body) {
        const result = await this.repository.withTransaction(async (client) => {
            const subscription = await this.repository.getActiveSubscription(orgId, client);
            if (!subscription) {
                throw new BillingError('No active subscription found', BillingErrorCodes.SUBSCRIPTION_NOT_FOUND, 404);
            }
            const addon = await this.repository.getAddonForUpdate(body.addonId, client);
            if (!addon) {
                throw new BillingError('Add-on not found', BillingErrorCodes.ADDON_NOT_FOUND, 404);
            }
            if (!addon.target_feature_id) {
                throw new BillingError('Add-on is not linked to a billing feature', BillingErrorCodes.ADDON_NOT_FOUND, 400);
            }
            const row = await this.repository.subscribeAddon(orgId, body, client);
            if (!row) {
                throw new BillingError('Unable to subscribe add-on', BillingErrorCodes.ADDON_NOT_FOUND, 404);
            }
            return { success: true, data: row };
        });
        entitlementsService.invalidateOrgCache(orgId);
        return result;
    }
    async cancelSubscriptionAddon(orgId, subscriptionAddonId) {
        const row = await this.repository.cancelSubscriptionAddon(orgId, subscriptionAddonId);
        if (!row) {
            throw new BillingError('Subscription add-on not found', BillingErrorCodes.ADDON_NOT_FOUND, 404);
        }
        entitlementsService.invalidateOrgCache(orgId);
        return { success: true, data: row };
    }
}
//# sourceMappingURL=service.js.map
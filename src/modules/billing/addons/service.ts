import { BillingError, BillingErrorCodes } from '../shared/errors.js';
import { AddonsRepository } from './repository.js';
import type { ListAddonsQuery, SubscribeAddonBody } from './schemas.js';

export class AddonsService {
  constructor(private readonly repository: AddonsRepository) {}

  async listAddons(query: ListAddonsQuery) {
    const { data, total } = await this.repository.listAddons(query);
    const offset = (query.page - 1) * query.limit;
    return { success: true, data, meta: { page: query.page, limit: query.limit, total, hasMore: offset + data.length < total } };
  }

  async listSubscriptionAddons(orgId: string) {
    return { success: true, data: await this.repository.listSubscriptionAddons(orgId) };
  }

  async subscribeAddon(orgId: string, body: SubscribeAddonBody) {
    return this.repository.withTransaction(async (client) => {
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
  }

  async cancelSubscriptionAddon(orgId: string, subscriptionAddonId: string) {
    const row = await this.repository.cancelSubscriptionAddon(orgId, subscriptionAddonId);
    if (!row) {
      throw new BillingError('Subscription add-on not found', BillingErrorCodes.ADDON_NOT_FOUND, 404);
    }
    return { success: true, data: row };
  }
}

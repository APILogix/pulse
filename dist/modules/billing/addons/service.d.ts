import { AddonsRepository } from './repository.js';
import type { ListAddonsQuery, SubscribeAddonBody } from './schemas.js';
export declare class AddonsService {
    private readonly repository;
    constructor(repository: AddonsRepository);
    listAddons(query: ListAddonsQuery): Promise<{
        success: boolean;
        data: import("./repository.js").AddonRow[];
        meta: {
            page: number;
            limit: number;
            total: number;
            hasMore: boolean;
        };
    }>;
    listSubscriptionAddons(orgId: string): Promise<{
        success: boolean;
        data: import("./repository.js").SubscriptionAddonRow[];
    }>;
    subscribeAddon(orgId: string, body: SubscribeAddonBody): Promise<{
        success: boolean;
        data: import("./repository.js").SubscriptionAddonRow;
    }>;
    cancelSubscriptionAddon(orgId: string, subscriptionAddonId: string): Promise<{
        success: boolean;
        data: import("./repository.js").SubscriptionAddonRow;
    }>;
}
//# sourceMappingURL=service.d.ts.map
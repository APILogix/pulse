import type { Pool, PoolClient } from 'pg';
import { BillingProvider } from '../shared/types.js';
import type { ListAddonsQuery, SubscribeAddonBody } from './schemas.js';
type Db = Pool | PoolClient;
export interface AddonRow {
    id: string;
    key: string;
    name: string;
    description: string | null;
    category: string;
    target_module: string | null;
    target_feature_id: string | null;
    available_in_tiers: string[];
    not_available_in_tiers: string[];
    is_active: boolean;
    sort_order: number;
    metadata: Record<string, unknown>;
    prices: unknown[];
}
export interface SubscriptionAddonRow {
    id: string;
    subscription_id: string;
    organization_id: string;
    feature_id: string;
    quantity: number;
    starts_at: Date;
    expires_at: Date | null;
    provider: BillingProvider;
    provider_reference: string | null;
    status: string;
    metadata: Record<string, unknown>;
    addon_id: string | null;
    addon_key: string | null;
    module: string | null;
    created_at: Date;
    updated_at: Date;
}
export declare const SUBSCRIPTION_ADDON_COLUMNS = "\n  id, subscription_id, organization_id, feature_id, quantity, starts_at, expires_at,\n  provider, provider_reference, status, metadata, addon_id, addon_key, module,\n  created_at, updated_at\n";
export declare class AddonsRepository {
    private readonly db;
    constructor(db?: Pool);
    withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    listAddons(query: ListAddonsQuery, db?: Db): Promise<{
        data: AddonRow[];
        total: number;
    }>;
    listSubscriptionAddons(orgId: string, db?: Db): Promise<SubscriptionAddonRow[]>;
    getActiveSubscription(orgId: string, db: PoolClient): Promise<any>;
    getAddonForUpdate(addonId: string, db: PoolClient): Promise<any>;
    subscribeAddon(orgId: string, body: SubscribeAddonBody, db: PoolClient): Promise<SubscriptionAddonRow | null>;
    cancelSubscriptionAddon(orgId: string, subscriptionAddonId: string, db?: Db): Promise<SubscriptionAddonRow | null>;
}
export {};
//# sourceMappingURL=repository.d.ts.map
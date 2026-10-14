import { pool } from '../../../config/database.js';
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

export const SUBSCRIPTION_ADDON_COLUMNS = `
  id, subscription_id, organization_id, feature_id, quantity, starts_at, expires_at,
  provider, provider_reference, status, metadata, addon_id, addon_key, module,
  created_at, updated_at
`;

export class AddonsRepository {
  constructor(private readonly db: Pool = pool) {}

  async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listAddons(query: ListAddonsQuery, db: Db = this.db): Promise<{ data: AddonRow[]; total: number }> {
    const values: unknown[] = [];
    const where = ['a.is_active = TRUE'];
    if (query.tier) {
      values.push(query.tier);
      where.push(`($${values.length}::billing_plan_tier = ANY(a.available_in_tiers) OR cardinality(a.available_in_tiers) = 0)`);
      where.push(`NOT ($${values.length}::billing_plan_tier = ANY(a.not_available_in_tiers))`);
    }

    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total FROM addons a WHERE ${where.join(' AND ')}`,
      values,
    );

    values.push(query.billingInterval ?? null, query.limit, (query.page - 1) * query.limit);
    const result = await db.query(
      `SELECT a.id, a.key, a.name, a.description, a.category, a.target_module, a.target_feature_id,
              a.available_in_tiers, a.not_available_in_tiers, a.is_active, a.sort_order, a.metadata,
              a.created_at, a.updated_at,
              COALESCE(
                jsonb_agg(to_jsonb(ap) ORDER BY ap.is_default DESC, ap.amount_minor)
                  FILTER (WHERE ap.id IS NOT NULL),
                '[]'::jsonb
              ) AS prices
         FROM addons a
         LEFT JOIN addon_prices ap
           ON ap.addon_id = a.id
          AND ($${values.length - 2}::billing_interval_type IS NULL OR ap.billing_interval = $${values.length - 2}::billing_interval_type)
          AND (ap.starts_at IS NULL OR ap.starts_at <= NOW())
          AND (ap.ends_at IS NULL OR ap.ends_at > NOW())
        WHERE ${where.join(' AND ')}
        GROUP BY a.id
        ORDER BY a.sort_order, a.name
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return { data: result.rows, total: countResult.rows[0]?.total ?? 0 };
  }

  async listSubscriptionAddons(orgId: string, db: Db = this.db): Promise<SubscriptionAddonRow[]> {
    const result = await db.query(
      `SELECT ${SUBSCRIPTION_ADDON_COLUMNS}
         FROM subscription_addons
        WHERE organization_id = $1
          AND status IN ('active','scheduled')
        ORDER BY created_at DESC`,
      [orgId],
    );
    return result.rows;
  }

  async getActiveSubscription(orgId: string, db: PoolClient) {
    const result = await db.query(
      `SELECT id, organization_id, status, current_period_end, created_at
         FROM organization_subscriptions
        WHERE organization_id = $1
          AND status IN ('trialing','active')
          AND deleted_at IS NULL
          AND current_period_end > NOW()
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [orgId],
    );
    return result.rows[0] ?? null;
  }

  async getAddonForUpdate(addonId: string, db: PoolClient) {
    const result = await db.query(
      `SELECT id, key, target_feature_id, target_module, is_active
         FROM addons
        WHERE id = $1 AND is_active = TRUE`,
      [addonId],
    );
    return result.rows[0] ?? null;
  }

  async subscribeAddon(orgId: string, body: SubscribeAddonBody, db: PoolClient): Promise<SubscriptionAddonRow | null> {
    const subscription = await this.getActiveSubscription(orgId, db);
    if (!subscription) return null;

    const addon = await this.getAddonForUpdate(body.addonId, db);
    if (!addon?.target_feature_id) return null;

    const result = await db.query(
      `INSERT INTO subscription_addons (
         subscription_id, organization_id, feature_id, quantity, provider,
         status, metadata, addon_id, addon_key, module
       ) VALUES ($1,$2,$3,$4,'system','active',$5,$6,$7,$8)
       RETURNING ${SUBSCRIPTION_ADDON_COLUMNS}`,
      [
        subscription.id,
        orgId,
        addon.target_feature_id,
        body.quantity,
        JSON.stringify(body.metadata),
        addon.id,
        addon.key,
        addon.target_module,
      ],
    );
    return result.rows[0];
  }

  async cancelSubscriptionAddon(orgId: string, subscriptionAddonId: string, db: Db = this.db): Promise<SubscriptionAddonRow | null> {
    const result = await db.query(
      `UPDATE subscription_addons
          SET status = 'cancelled', updated_at = NOW()
        WHERE id = $1
          AND organization_id = $2
          AND status IN ('active','scheduled')
        RETURNING ${SUBSCRIPTION_ADDON_COLUMNS}`,
      [subscriptionAddonId, orgId],
    );
    return result.rows[0] ?? null;
  }
}

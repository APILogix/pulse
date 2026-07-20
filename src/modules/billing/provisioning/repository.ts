import type { PoolClient } from 'pg';
import { NotFoundError } from '../../organization/shared/errors.js';

export interface BillingProvisioningResult {
  subscriptionId: string;
  planId: string;
  status: 'active' | 'trialing';
}

/** SQL boundary for the Billing-owned part of organization provisioning. */
export class BillingProvisioningRepository {
  async provisionFreeSubscription(
    client: PoolClient,
    organizationId: string,
  ): Promise<BillingProvisioningResult> {
    const planResult = await client.query<{ id: string; trial_days: number }>(
      `SELECT id, trial_days
       FROM plans
       WHERE key = 'free' AND is_active = TRUE AND deleted_at IS NULL
       LIMIT 1
       FOR SHARE`,
    );
    const plan = planResult.rows[0];
    if (!plan) throw new NotFoundError('Free billing plan');

    const periodResult = await client.query<{ period_start: Date; period_end: Date }>(
      `SELECT NOW() AS period_start, NOW() + INTERVAL '1 month' AS period_end`,
    );
    const period = periodResult.rows[0]!;
    const status: BillingProvisioningResult['status'] = plan.trial_days > 0 ? 'trialing' : 'active';

    const subscriptionResult = await client.query<{ id: string }>(
      `INSERT INTO organization_subscriptions (
         organization_id, plan_id, status, provider, billing_interval,
         current_period_start, current_period_end, trial_start, trial_end,
         cancel_at_period_end
       ) VALUES (
         $1,
         $2,
         $3::billing_subscription_status,
         'system'::billing_provider_type,
         'monthly'::billing_interval_type,
         $4::timestamptz,
         $5::timestamptz,
         CASE WHEN $3::billing_subscription_status = 'trialing' THEN $4::timestamptz ELSE NULL END,
         CASE WHEN $3::billing_subscription_status = 'trialing' THEN $4::timestamptz + ($6::integer * INTERVAL '1 day') ELSE NULL END,
         FALSE
       ) RETURNING id`,
      [organizationId, plan.id, status, period.period_start, period.period_end, plan.trial_days],
    );
    const subscriptionId = subscriptionResult.rows[0]!.id;

    await client.query(
      `INSERT INTO subscription_events (
         organization_id, subscription_id, event_type, actor, new_plan_id, metadata
       ) VALUES ($1, $2, 'created', 'system', $3, $4::jsonb)`,
      [organizationId, subscriptionId, plan.id, JSON.stringify({ reason: 'organization_created' })],
    );

    await client.query(
      `INSERT INTO organization_usage_current_period (
         organization_id, subscription_id, period_start, period_end,
         event_limit, ai_credit_limit, members_used
       )
       SELECT
         $1, $2, $3, $4,
         COALESCE(MAX(pfe.integer_value) FILTER (WHERE bf.feature_key = 'monthly_events'), 0),
         COALESCE(MAX(pfe.integer_value) FILTER (WHERE bf.feature_key = 'ai_credits'), 0),
         1
       FROM plan_feature_entitlements pfe
       JOIN billing_features bf ON bf.id = pfe.feature_id
       WHERE pfe.plan_id = $5
         AND pfe.deleted_at IS NULL
         AND bf.deleted_at IS NULL`,
      [organizationId, subscriptionId, period.period_start, period.period_end, plan.id],
    );

    return { subscriptionId, planId: plan.id, status };
  }
}

import { NotFoundError } from '../../organization/shared/errors.js';
import { AI_CREDIT_LIMIT_FEATURE_KEY, EVENT_LIMIT_FEATURE_KEY, buildEntitlementsSnapshot, buildModulesSnapshot, integerEntitlement, usageLimitParameter, } from '../shared/entitlement-snapshot.js';
const DEFAULT_PLAN_KEY = 'business';
const REQUIRED_DEFAULT_PLAN_FEATURES = [EVENT_LIMIT_FEATURE_KEY, AI_CREDIT_LIMIT_FEATURE_KEY];
/** SQL boundary for the Billing-owned part of organization provisioning. */
export class BillingProvisioningRepository {
    async provisionDefaultSubscription(client, organizationId) {
        const planResult = await client.query(`SELECT id, key, version, tier, trial_days
       FROM plans
       WHERE key = $1 AND is_active = TRUE AND deleted_at IS NULL
       ORDER BY version DESC, sort_order ASC, created_at DESC
       LIMIT 1
       FOR SHARE`, [DEFAULT_PLAN_KEY]);
        const plan = planResult.rows[0];
        if (!plan)
            throw new NotFoundError('Business billing plan');
        const entitlementsResult = await client.query(`SELECT
         bf.feature_key,
         bf.module,
         bf.is_module_root,
         bf.value_type,
         pfe.boolean_value,
         pfe.integer_value,
         pfe.decimal_value,
         pfe.string_value
       FROM plan_feature_entitlements pfe
       JOIN billing_features bf ON bf.id = pfe.feature_id
       WHERE pfe.plan_id = $1
         AND pfe.deleted_at IS NULL
         AND bf.deleted_at IS NULL
         AND bf.is_deprecated = FALSE
       ORDER BY bf.sort_order ASC, bf.feature_key ASC
       FOR SHARE`, [plan.id]);
        const entitlements = entitlementsResult.rows;
        if (entitlements.length === 0) {
            throw new NotFoundError('Business billing plan entitlements');
        }
        const missingRequiredFeature = REQUIRED_DEFAULT_PLAN_FEATURES.find((featureKey) => !entitlements.some((entitlement) => entitlement.feature_key === featureKey));
        if (missingRequiredFeature) {
            throw new NotFoundError(`Business billing plan entitlement ${missingRequiredFeature}`);
        }
        const priceResult = await client.query(`SELECT id, provider, billing_interval, currency, amount_minor, provider_price_id
       FROM plan_prices
       WHERE plan_id = $1
         AND deleted_at IS NULL
         AND billing_interval = 'monthly'
         AND (starts_at IS NULL OR starts_at <= NOW())
         AND (ends_at IS NULL OR ends_at > NOW())
       ORDER BY is_default DESC, amount_minor ASC, created_at DESC
       LIMIT 1
       FOR SHARE`, [plan.id]);
        const price = priceResult.rows[0] ?? null;
        const modules = buildModulesSnapshot(entitlements);
        const entitlementSnapshot = buildEntitlementsSnapshot(entitlements);
        const eventLimit = integerEntitlement(entitlements, EVENT_LIMIT_FEATURE_KEY);
        const aiCreditLimit = integerEntitlement(entitlements, AI_CREDIT_LIMIT_FEATURE_KEY);
        const periodStart = new Date();
        const periodEnd = new Date(periodStart);
        if (plan.trial_days > 0) {
            periodEnd.setDate(periodEnd.getDate() + plan.trial_days);
        }
        else {
            periodEnd.setMonth(periodEnd.getMonth() + 1);
        }
        const status = plan.trial_days > 0 ? 'trialing' : 'active';
        const provisioningMetadata = {
            reason: 'organization_created',
            provisionedBy: 'billing_provisioning',
            plan: {
                id: plan.id,
                key: plan.key,
                tier: plan.tier,
                version: plan.version,
                trialDays: plan.trial_days,
            },
            price: price
                ? {
                    id: price.id,
                    provider: price.provider,
                    billingInterval: price.billing_interval,
                    currency: price.currency,
                    amountMinor: Number(price.amount_minor),
                    providerPriceId: price.provider_price_id,
                }
                : null,
            limits: {
                monthlyEvents: eventLimit,
                aiCredits: aiCreditLimit,
            },
            featureCount: entitlements.length,
        };
        const subscriptionResult = await client.query(`INSERT INTO organization_subscriptions (
         organization_id, plan_id, status, provider, billing_interval,
         current_period_start, current_period_end, trial_start, trial_end,
         cancel_at_period_end, modules, metadata
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
         FALSE,
         $7::jsonb,
         $8::jsonb
       ) RETURNING id`, [
            organizationId,
            plan.id,
            status,
            periodStart,
            periodEnd,
            plan.trial_days,
            JSON.stringify(modules),
            JSON.stringify(provisioningMetadata),
        ]);
        const subscriptionId = subscriptionResult.rows[0].id;
        // Batched single round-trip insert for subscription_events, usage counters, and audit logs
        await client.query(`WITH ins_event AS (
         INSERT INTO subscription_events (
           organization_id, subscription_id, event_type, actor, new_plan_id, metadata
         ) VALUES ($1, $2, 'created', 'system', $3, $4::jsonb)
       ),
       ins_usage AS (
         INSERT INTO organization_usage_current_period (
           organization_id, subscription_id, period_start, period_end,
           events_used, ai_credits_used, projects_used, members_used,
           api_keys_used, connectors_used, alert_rules_used, dashboards_used,
           event_limit, ai_credit_limit, overage_events, overage_ai_credits,
           metadata
         ) VALUES (
           $1, $2, $5, $6,
           0, 0, 0, 1,
           0, 0, 0, 0,
           $7, $8, 0, 0,
           $9::jsonb
         )
       )
       INSERT INTO billing_audit_logs (
         organization_id, subscription_id, actor_type, action, new_state, metadata
       ) VALUES (
         $1, $2, 'system', 'subscription.provisioned', $10::jsonb, $4::jsonb
       )`, [
            organizationId,
            subscriptionId,
            plan.id,
            JSON.stringify(provisioningMetadata),
            periodStart,
            periodEnd,
            usageLimitParameter(eventLimit),
            usageLimitParameter(aiCreditLimit),
            JSON.stringify({
                source: 'billing_provisioning',
                entitlements: entitlementSnapshot,
                modules,
            }),
            JSON.stringify({
                status,
                planId: plan.id,
                periodStart,
                periodEnd,
                eventLimit,
                aiCreditLimit,
            }),
        ]);
        return { subscriptionId, planId: plan.id, status, featureCount: entitlements.length, eventLimit, aiCreditLimit };
    }
}
//# sourceMappingURL=repository.js.map
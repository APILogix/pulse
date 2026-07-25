import { pool } from '../../../config/database.js';
import { generateUUID } from '../../../shared/utils/id.js';
const resourceColumns = {
    projects: { used: 'projects_used', limit: 'projects_limit' },
    members: { used: 'members_used', limit: 'members_limit' },
    apiKeys: { used: 'api_keys_used', limit: 'api_keys_limit' },
    connectors: { used: 'connectors_used', limit: 'connectors_limit' },
    alertRules: { used: 'alert_rules_used', limit: 'alert_rules_limit' },
    dashboards: { used: 'dashboards_used', limit: 'dashboards_limit' },
};
export class InternalBillingRepository {
    db;
    constructor(db = pool) {
        this.db = db;
    }
    async withTransaction(callback) {
        const client = await this.db.connect();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async getResolvedEntitlements(orgId, db = this.db) {
        const result = await db.query(`SELECT ee.feature_key, ee.boolean_value, ee.integer_value, ee.decimal_value, ee.string_value,
              bf.module, bf.is_module_root, bf.value_type
         FROM v_effective_entitlements ee
         LEFT JOIN billing_features bf ON bf.feature_key = ee.feature_key
        WHERE ee.organization_id = $1
        ORDER BY bf.sort_order NULLS LAST, ee.feature_key`, [orgId]);
        return result.rows;
    }
    async getFeatureValue(orgId, featureKey, db = this.db) {
        const result = await db.query(`SELECT ee.feature_key, ee.boolean_value, ee.integer_value, ee.decimal_value, ee.string_value,
              bf.module, bf.is_module_root, bf.value_type
         FROM v_effective_entitlements ee
         LEFT JOIN billing_features bf ON bf.feature_key = ee.feature_key
        WHERE ee.organization_id = $1 AND ee.feature_key = $2
        LIMIT 1`, [orgId, featureKey]);
        return result.rows[0] ?? null;
    }
    async getCurrentUsageForUpdate(orgId, db) {
        const result = await db.query(`SELECT * FROM organization_usage_current_period
        WHERE organization_id = $1
        ORDER BY period_end DESC
        LIMIT 1
        FOR UPDATE`, [orgId]);
        return result.rows[0] ?? null;
    }
    async getCurrentUsage(orgId, db = this.db) {
        const result = await db.query(`SELECT * FROM organization_usage_current_period
        WHERE organization_id = $1
        ORDER BY period_end DESC
        LIMIT 1`, [orgId]);
        return result.rows[0] ?? null;
    }
    async incrementEventUsage(body, acceptedCount, overageCount, db) {
        await db.query(`UPDATE organization_usage_current_period
          SET events_used = events_used + $2,
              overage_events = overage_events + $3,
              last_event_at = NOW()
        WHERE organization_id = $1`, [body.organizationId, acceptedCount, overageCount]);
        await db.query(`INSERT INTO usage_daily_counters (
         id, organization_id, project_id, usage_date, events_count, requests_count,
         errors_count, traces_count, spans_count, metrics_count, logs_count,
         profiles_count, replays_count, created_at, updated_at
       ) VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
       ON CONFLICT (organization_id, project_id, usage_date)
       DO UPDATE SET
         events_count = usage_daily_counters.events_count + EXCLUDED.events_count,
         requests_count = usage_daily_counters.requests_count + EXCLUDED.requests_count,
         errors_count = usage_daily_counters.errors_count + EXCLUDED.errors_count,
         traces_count = usage_daily_counters.traces_count + EXCLUDED.traces_count,
         spans_count = usage_daily_counters.spans_count + EXCLUDED.spans_count,
         metrics_count = usage_daily_counters.metrics_count + EXCLUDED.metrics_count,
         logs_count = usage_daily_counters.logs_count + EXCLUDED.logs_count,
         profiles_count = usage_daily_counters.profiles_count + EXCLUDED.profiles_count,
         replays_count = usage_daily_counters.replays_count + EXCLUDED.replays_count,
         updated_at = NOW()`, [
            generateUUID(),
            body.organizationId,
            body.projectId ?? null,
            body.count,
            body.eventType === 'request' ? body.count : 0,
            body.eventType === 'error' ? body.count : 0,
            body.eventType === 'trace' ? body.count : 0,
            body.eventType === 'span' ? body.count : 0,
            body.eventType === 'metric' ? body.count : 0,
            body.eventType === 'log' ? body.count : 0,
            body.eventType === 'profile' ? body.count : 0,
            body.eventType === 'replay' ? body.count : 0,
        ]);
    }
    async incrementAiCredits(body, db) {
        const promptTokens = body.tokens?.prompt ?? 0;
        const completionTokens = body.tokens?.completion ?? 0;
        const totalTokens = body.tokens?.total ?? promptTokens + completionTokens;
        await db.query(`UPDATE organization_usage_current_period
          SET ai_credits_used = ai_credits_used + $2,
              overage_ai_credits = GREATEST((ai_credits_used + $2) - ai_credit_limit, 0),
              last_ai_request_at = NOW()
        WHERE organization_id = $1`, [body.organizationId, body.credits]);
        await db.query(`INSERT INTO ai_usage_logs (
         id, organization_id, project_id, user_id, occurred_at, feature_key,
         provider, model, credits_used, prompt_tokens, completion_tokens,
         total_tokens, status, created_at
       ) VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, $8, $9, $10, $11, 'accepted', NOW())`, [
            generateUUID(),
            body.organizationId,
            body.projectId ?? null,
            body.userId ?? null,
            body.featureKey,
            body.provider ?? null,
            body.model ?? null,
            body.credits,
            promptTokens,
            completionTokens,
            totalTokens,
        ]);
    }
    async adjustResourceUsage(body, direction, db) {
        const columns = resourceColumns[body.resourceType];
        const delta = body.delta * direction;
        const result = await db.query(`UPDATE organization_usage_current_period
          SET ${columns.used} = GREATEST(${columns.used} + $2, 0)
        WHERE organization_id = $1
        RETURNING ${columns.used} AS used, ${columns.limit} AS limit`, [body.organizationId, delta]);
        return result.rows[0] ?? null;
    }
    async getSubscriptionStatus(orgId, db = this.db) {
        const result = await db.query(`SELECT s.status, p.key AS plan_key, s.trial_start, s.trial_end, s.cancel_at_period_end
         FROM organization_subscriptions s
         JOIN plans p ON p.id = s.plan_id
        WHERE s.organization_id = $1
          AND s.status IN ('trialing', 'active', 'past_due', 'incomplete')
          AND COALESCE(s.deleted_at IS NULL, TRUE)
        ORDER BY s.current_period_end DESC
        LIMIT 1`, [orgId]);
        return result.rows[0] ?? null;
    }
    async generateInvoice(body, db) {
        const subscription = await db.query(`SELECT id, plan_id, billing_interval, provider, current_period_start, current_period_end
         FROM organization_subscriptions
        WHERE organization_id = $1
          AND current_period_end <= $2
          AND status IN ('trialing', 'active', 'past_due')
          AND COALESCE(deleted_at IS NULL, TRUE)
        ORDER BY current_period_end DESC
        LIMIT 1
        FOR UPDATE`, [body.organizationId, body.periodEnd]);
        const sub = subscription.rows[0];
        if (!sub)
            return null;
        const price = await db.query(`SELECT currency, amount_minor
         FROM plan_prices
        WHERE plan_id = $1
          AND billing_interval = $2
          AND is_default = TRUE
          AND (starts_at IS NULL OR starts_at <= NOW())
          AND (ends_at IS NULL OR ends_at > NOW())
        ORDER BY starts_at DESC NULLS LAST
        LIMIT 1`, [sub.plan_id, sub.billing_interval]);
        const currency = price.rows[0]?.currency ?? 'usd';
        const amount = Number(price.rows[0]?.amount_minor ?? 0);
        const invoiceId = generateUUID();
        const invoice = await db.query(`INSERT INTO invoices (
         id, organization_id, subscription_id, provider, status, currency,
         subtotal_amount, tax_amount, discount_amount, total_amount, amount_paid,
         period_start, period_end, overage_events, overage_amount, metadata
       ) VALUES ($1, $2, $3, $4, 'draft', $5, $6, 0, 0, $6, 0, $7, $8, 0, 0, '{}'::jsonb)
       RETURNING *`, [
            invoiceId,
            body.organizationId,
            sub.id,
            sub.provider,
            currency,
            amount,
            sub.current_period_start,
            sub.current_period_end,
        ]);
        await db.query(`INSERT INTO invoice_line_items (
         id, invoice_id, line_type, description, quantity, unit_amount_minor,
         amount_minor, plan_id, metadata, created_at
       ) VALUES ($1, $2, 'plan', 'Plan subscription', 1, $3, $3, $4, '{}'::jsonb, NOW())`, [generateUUID(), invoiceId, amount, sub.plan_id]);
        return invoice.rows[0];
    }
    async finalizeInvoice(body, db) {
        const result = await db.query(`UPDATE invoices
          SET status = 'open'
        WHERE id = $1 AND status = 'draft'
        RETURNING *`, [body.invoiceId]);
        return result.rows[0] ?? null;
    }
    async reconcilePayments(body, db) {
        const result = await db.query(`UPDATE payments
          SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('lastReconciledAt', NOW())
        WHERE provider = $1
          AND initiated_at >= $2
          AND initiated_at <= $3
        RETURNING id`, [body.provider, body.dateFrom, body.dateTo]);
        return { reconciled: result.rowCount ?? 0, paymentIds: result.rows.map((row) => row.id) };
    }
    async validateCoupon(body, db = this.db) {
        const result = await db.query(`SELECT c.*
         FROM coupons c
         LEFT JOIN coupon_applicable_plans cap ON cap.coupon_id = c.id
        WHERE LOWER(c.code) = LOWER($1)
          AND c.is_active = TRUE
          AND (c.valid_from IS NULL OR c.valid_from <= NOW())
          AND (c.valid_until IS NULL OR c.valid_until > NOW())
          AND (c.max_redemptions IS NULL OR c.redemption_count < c.max_redemptions)
          AND (cap.plan_id IS NULL OR cap.plan_id = $2)
        ORDER BY c.created_at DESC NULLS LAST
        LIMIT 1`, [body.code, body.planId]);
        return result.rows[0] ?? null;
    }
    async redeemCoupon(body, discountAmount, currency, db) {
        const couponResult = await db.query(`SELECT * FROM coupons
        WHERE LOWER(code) = LOWER($1)
          AND is_active = TRUE
          AND (valid_from IS NULL OR valid_from <= NOW())
          AND (valid_until IS NULL OR valid_until > NOW())
        LIMIT 1
        FOR UPDATE`, [body.code]);
        const coupon = couponResult.rows[0];
        if (!coupon)
            return null;
        const existing = await db.query(`SELECT id FROM coupon_redemptions
        WHERE coupon_id = $1 AND organization_id = $2
        LIMIT 1`, [coupon.id, body.organizationId]);
        if (existing.rows[0])
            return { alreadyRedeemed: true, coupon };
        const redemption = await db.query(`INSERT INTO coupon_redemptions (
         id, coupon_id, organization_id, subscription_id, invoice_id,
         discount_amount, currency, redemption_source, metadata, redeemed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'internal', '{}'::jsonb, NOW())
       RETURNING *`, [
            generateUUID(),
            coupon.id,
            body.organizationId,
            body.subscriptionId,
            body.invoiceId ?? null,
            discountAmount,
            currency,
        ]);
        await db.query(`UPDATE coupons SET redemption_count = redemption_count + 1 WHERE id = $1`, [coupon.id]);
        return { alreadyRedeemed: false, coupon, redemption: redemption.rows[0] };
    }
}
//# sourceMappingURL=repository.js.map
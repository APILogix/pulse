/**
 * Billing repository backed by the canonical migrations2 billing tables.
 */
import { pool } from '../../config/database.js';
import { BillingInterval, InvoiceStatus, PaymentMethodType, PlanTier, SubscriptionStatus, UsageMetricType, } from './types.js';
const PLAN_COLUMNS = `
  id,
  key,
  version,
  name,
  description,
  tier,
  is_public,
  sort_order,
  event_limit_monthly,
  hard_cap,
  price_inr_monthly,
  price_usd_monthly,
  price_inr_annual,
  price_usd_annual,
  overage_price_per_1k_inr,
  overage_price_per_1k_usd,
  feature_config,
  is_active,
  created_at,
  updated_at
`;
const SUBSCRIPTION_COLUMNS = `
  id,
  org_id,
  plan_id,
  status,
  billing_provider,
  provider_customer_id,
  provider_subscription_id,
  billing_interval,
  current_period_start,
  current_period_end,
  trial_start,
  trial_end,
  cancel_at_period_end,
  canceled_at,
  seats,
  created_at,
  updated_at
`;
const SUBSCRIPTION_EVENT_COLUMNS = `
  id,
  org_id,
  subscription_id,
  event_type,
  old_plan_id,
  new_plan_id,
  actor,
  metadata,
  created_at
`;
const INVOICE_COLUMNS = `
  id,
  org_id,
  subscription_id,
  provider,
  provider_invoice_id,
  status,
  amount_due,
  amount_paid,
  currency,
  period_start,
  period_end,
  overage_events,
  overage_amount,
  pdf_url,
  paid_at,
  created_at
`;
const USAGE_DAILY_COUNTER_COLUMNS = `
  id,
  org_id,
  project_id,
  date,
  events_count,
  ai_analyses_count,
  updated_at
`;
const COUPON_COLUMNS = `
  id,
  code,
  discount_type,
  discount_value,
  max_redemptions,
  redemption_count,
  valid_from,
  valid_until,
  is_active,
  created_at
`;
const QUOTA_REQUEST_COLUMNS = `
  id,
  org_id,
  quota_type,
  requested_limit,
  current_limit,
  reason,
  status,
  reviewed_by,
  reviewed_at,
  notes,
  created_at
`;
export class BillingRepository {
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
    async getAllPlans(includeHidden = false) {
        const result = await this.db.query(includeHidden
            ? `SELECT ${PLAN_COLUMNS} FROM plans WHERE is_active = TRUE ORDER BY sort_order ASC, key ASC, version DESC`
            : `SELECT ${PLAN_COLUMNS} FROM plans WHERE is_active = TRUE AND is_public = TRUE ORDER BY sort_order ASC, key ASC, version DESC`);
        return result.rows.map(mapPlanFromDb);
    }
    async getPlanById(planId, db = this.db) {
        const result = await db.query(`SELECT ${PLAN_COLUMNS} FROM plans WHERE id = $1`, [planId]);
        return result.rows[0] ? mapPlanFromDb(result.rows[0]) : null;
    }
    async getPlanByTier(tier, db = this.db) {
        const result = await db.query(`SELECT ${PLAN_COLUMNS} FROM plans
       WHERE tier = $1 AND is_active = TRUE
       ORDER BY version DESC
       LIMIT 1`, [tier]);
        return result.rows[0] ? mapPlanFromDb(result.rows[0]) : null;
    }
    async getOrganizationBilling(orgId, db = this.db) {
        const result = await db.query(`SELECT ${prefixColumns(SUBSCRIPTION_COLUMNS, 's')}
       FROM organization_subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.org_id = $1
         AND s.status IN ('trialing','active','past_due')
       ORDER BY s.created_at DESC
       LIMIT 1`, [orgId]);
        return result.rows[0] ? mapSubscriptionFromDb(result.rows[0]) : null;
    }
    async getOrganizationBillingForUpdate(orgId, db) {
        const result = await db.query(`SELECT ${SUBSCRIPTION_COLUMNS}
       FROM organization_subscriptions
       WHERE org_id = $1
         AND status IN ('trialing','active','past_due')
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`, [orgId]);
        return result.rows[0] ? mapSubscriptionFromDb(result.rows[0]) : null;
    }
    async createOrganizationBilling(billing, db = this.db) {
        const result = await db.query(`INSERT INTO organization_subscriptions (
         org_id, plan_id, status, billing_provider, provider_customer_id,
         provider_subscription_id, billing_interval, current_period_start,
         current_period_end, trial_start, trial_end, cancel_at_period_end,
         canceled_at, seats
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING ${SUBSCRIPTION_COLUMNS}`, [
            billing.orgId,
            billing.planId,
            billing.status ?? SubscriptionStatus.TRIALING,
            billing.billingProvider ?? 'system',
            billing.providerCustomerId ?? null,
            billing.providerSubscriptionId ?? null,
            billing.billingInterval ?? BillingInterval.MONTHLY,
            billing.currentPeriodStart,
            billing.currentPeriodEnd,
            billing.trialStart ?? null,
            billing.trialEnd ?? null,
            billing.cancelAtPeriodEnd ?? false,
            billing.canceledAt ?? null,
            billing.seats ?? null,
        ]);
        return mapSubscriptionFromDb(result.rows[0]);
    }
    async updateOrganizationBilling(orgId, updates, db = this.db) {
        const fields = [];
        const values = [];
        let i = 1;
        const add = (column, value) => {
            fields.push(`${column} = $${i++}`);
            values.push(value);
        };
        if (updates.planId !== undefined)
            add('plan_id', updates.planId);
        if (updates.status !== undefined)
            add('status', updates.status);
        if (updates.billingProvider !== undefined)
            add('billing_provider', updates.billingProvider);
        if (updates.providerCustomerId !== undefined)
            add('provider_customer_id', updates.providerCustomerId);
        if (updates.providerSubscriptionId !== undefined)
            add('provider_subscription_id', updates.providerSubscriptionId);
        if (updates.billingInterval !== undefined)
            add('billing_interval', updates.billingInterval);
        if (updates.currentPeriodStart !== undefined)
            add('current_period_start', updates.currentPeriodStart);
        if (updates.currentPeriodEnd !== undefined)
            add('current_period_end', updates.currentPeriodEnd);
        if (updates.trialStart !== undefined)
            add('trial_start', updates.trialStart);
        if (updates.trialEnd !== undefined)
            add('trial_end', updates.trialEnd);
        if (updates.cancelAtPeriodEnd !== undefined)
            add('cancel_at_period_end', updates.cancelAtPeriodEnd);
        if (updates.canceledAt !== undefined)
            add('canceled_at', updates.canceledAt);
        if (updates.seats !== undefined)
            add('seats', updates.seats);
        fields.push('updated_at = NOW()');
        values.push(orgId);
        const result = await db.query(`UPDATE organization_subscriptions
       SET ${fields.join(', ')}
       WHERE org_id = $${i}
         AND status IN ('trialing','active','past_due')
       RETURNING ${SUBSCRIPTION_COLUMNS}`, values);
        if (!result.rows[0]) {
            throw new Error('No active subscription found to update');
        }
        return mapSubscriptionFromDb(result.rows[0]);
    }
    async createSubscriptionEvent(event, db = this.db) {
        await db.query(`INSERT INTO subscription_events (
         org_id, subscription_id, event_type, old_plan_id, new_plan_id, actor, metadata
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
            event.orgId,
            event.subscriptionId,
            event.eventType,
            event.oldPlanId ?? null,
            event.newPlanId ?? null,
            event.actor,
            JSON.stringify(event.metadata ?? {}),
        ]);
    }
    async listSubscriptionEvents(orgId) {
        const result = await this.db.query(`SELECT ${SUBSCRIPTION_EVENT_COLUMNS}
       FROM subscription_events
       WHERE org_id = $1
       ORDER BY created_at DESC`, [orgId]);
        return result.rows;
    }
    async getInvoices(orgId, options = {}) {
        const where = ['org_id = $1'];
        const values = [orgId];
        let i = 2;
        if (options.status) {
            where.push(`status = $${i++}`);
            values.push(options.status);
        }
        if (options.startDate) {
            where.push(`created_at >= $${i++}`);
            values.push(options.startDate);
        }
        if (options.endDate) {
            where.push(`created_at <= $${i++}`);
            values.push(options.endDate);
        }
        const whereSql = where.join(' AND ');
        const count = await this.db.query(`SELECT COUNT(*)::int AS count FROM invoices WHERE ${whereSql}`, values);
        let sql = `SELECT ${INVOICE_COLUMNS} FROM invoices WHERE ${whereSql} ORDER BY created_at DESC`;
        if (options.limit !== undefined) {
            sql += ` LIMIT $${i++}`;
            values.push(options.limit);
        }
        if (options.offset !== undefined) {
            sql += ` OFFSET $${i++}`;
            values.push(options.offset);
        }
        const result = await this.db.query(sql, values);
        return { invoices: result.rows.map(mapInvoiceFromDb), total: count.rows[0]?.count ?? 0 };
    }
    async getInvoiceById(id, orgId) {
        const result = await this.db.query(`SELECT ${INVOICE_COLUMNS} FROM invoices WHERE id = $1 AND org_id = $2`, [id, orgId]);
        return result.rows[0] ? mapInvoiceFromDb(result.rows[0]) : null;
    }
    async createInvoice(invoice, db = this.db) {
        const result = await db.query(`INSERT INTO invoices (
         org_id, subscription_id, provider, provider_invoice_id, status,
         amount_due, amount_paid, currency, period_start, period_end,
         overage_events, overage_amount, pdf_url, paid_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING ${INVOICE_COLUMNS}`, [
            invoice.orgId,
            invoice.subscriptionId,
            invoice.provider ?? 'manual',
            invoice.providerInvoiceId ?? `manual_${Date.now()}`,
            invoice.status ?? InvoiceStatus.DRAFT,
            invoice.amountDue ?? invoice.total ?? 0,
            invoice.amountPaid ?? 0,
            invoice.currency ?? 'USD',
            invoice.periodStart,
            invoice.periodEnd,
            invoice.overageEvents ?? 0,
            invoice.overageAmount ?? 0,
            invoice.pdfUrl ?? null,
            invoice.paidAt ?? null,
        ]);
        return mapInvoiceFromDb(result.rows[0]);
    }
    async updateInvoiceStatus(id, status, paymentDetails, db = this.db) {
        const result = await db.query(`UPDATE invoices
       SET status = $1,
           paid_at = COALESCE($2, paid_at),
           amount_paid = COALESCE($3, amount_paid)
       WHERE id = $4
       RETURNING ${INVOICE_COLUMNS}`, [status, paymentDetails?.paidAt ?? null, paymentDetails?.amountPaid ?? null, id]);
        return mapInvoiceFromDb(result.rows[0]);
    }
    async getUpcomingInvoice(orgId) {
        const subscription = await this.getOrganizationBilling(orgId);
        if (!subscription)
            return null;
        const plan = await this.getPlanById(subscription.planId);
        if (!plan)
            return null;
        const amountDue = subscription.billingInterval === BillingInterval.ANNUAL
            ? plan.priceUsdAnnual ?? 0
            : plan.priceUsdMonthly ?? 0;
        return {
            orgId,
            subscriptionId: subscription.id,
            provider: subscription.billingProvider ?? 'system',
            providerInvoiceId: `upcoming_${subscription.id}`,
            invoiceNumber: `upcoming_${subscription.id}`,
            status: InvoiceStatus.DRAFT,
            invoiceDate: new Date(),
            dueDate: subscription.currentPeriodEnd,
            paidAt: null,
            periodStart: subscription.currentPeriodStart,
            periodEnd: subscription.currentPeriodEnd,
            subtotal: amountDue,
            discountAmount: 0,
            discountCode: null,
            taxAmount: 0,
            taxRate: 0,
            total: amountDue,
            amountPaid: 0,
            amountDue,
            currency: 'USD',
            lineItems: [{
                    description: `${plan.name} - ${subscription.billingInterval ?? BillingInterval.MONTHLY}`,
                    amount: amountDue,
                    quantity: 1,
                    unitPrice: amountDue,
                    type: 'plan',
                }],
            paymentMethod: null,
            paymentIntentId: null,
            stripeInvoiceId: null,
            pdfUrl: null,
            footerNote: null,
            memo: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
    }
    async getUsageRecords(orgId, options = {}) {
        const values = [orgId];
        let i = 2;
        const where = ['org_id = $1'];
        if (options.startDate) {
            where.push(`date >= $${i++}`);
            values.push(options.startDate);
        }
        if (options.endDate) {
            where.push(`date <= $${i++}`);
            values.push(options.endDate);
        }
        const result = await this.db.query(`SELECT ${USAGE_DAILY_COUNTER_COLUMNS}
       FROM usage_daily_counters
       WHERE ${where.join(' AND ')}
       ORDER BY date DESC`, values);
        return result.rows.map((row) => mapUsageRecordFromDb(row, options.metricType ?? UsageMetricType.API_REQUESTS));
    }
    async getUsageCounter(orgId) {
        const result = await this.db.query(`SELECT
         org_id,
         date_trunc('month', NOW()) AS current_period_start,
         COALESCE(SUM(events_count), 0)::bigint AS events_count,
         COALESCE(SUM(ai_analyses_count), 0)::bigint AS ai_analyses_count,
         MAX(updated_at) AS last_updated_at
       FROM usage_daily_counters
       WHERE org_id = $1
         AND date_trunc('month', date::timestamp) = date_trunc('month', NOW())
       GROUP BY org_id`, [orgId]);
        if (!result.rows[0])
            return null;
        return mapUsageCounterFromDb(result.rows[0]);
    }
    async getCouponByCode(code, db = this.db) {
        const result = await db.query(`SELECT ${COUPON_COLUMNS}
       FROM coupons
       WHERE code = $1 AND is_active = TRUE
       LIMIT 1
       FOR UPDATE`, [code.toUpperCase()]);
        return result.rows[0] ? mapCouponFromDb(result.rows[0]) : null;
    }
    async redeemCoupon(couponId, orgId, db = this.db) {
        await db.query(`INSERT INTO coupon_redemptions (coupon_id, org_id)
       VALUES ($1, $2)
       ON CONFLICT (coupon_id, org_id) DO NOTHING`, [couponId, orgId]);
        await db.query(`UPDATE coupons
       SET redemption_count = redemption_count + 1,
           updated_at = NOW()
       WHERE id = $1`, [couponId]);
    }
    async incrementCouponUsage(code, db = this.db) {
        await db.query(`UPDATE coupons
       SET redemption_count = redemption_count + 1,
           updated_at = NOW()
       WHERE code = $1`, [code.toUpperCase()]);
    }
    async createQuotaRequest(request) {
        const result = await this.db.query(`INSERT INTO quota_requests (org_id, quota_type, requested_limit, current_limit, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${QUOTA_REQUEST_COLUMNS}`, [request.orgId, request.quotaType, request.requestedLimit, request.currentLimit, request.reason]);
        return mapQuotaRequestFromDb(result.rows[0]);
    }
    async getQuotaRequests(orgId) {
        const result = await this.db.query(`SELECT ${QUOTA_REQUEST_COLUMNS} FROM quota_requests WHERE org_id = $1 ORDER BY created_at DESC`, [orgId]);
        return result.rows.map(mapQuotaRequestFromDb);
    }
    async getPaymentMethods(_orgId) {
        return [];
    }
    async getPaymentMethodById(_id, _orgId) {
        return null;
    }
    async createPaymentMethod(paymentMethod) {
        return {
            id: paymentMethod.id ?? 'not-persisted',
            orgId: paymentMethod.orgId ?? '',
            type: paymentMethod.type ?? PaymentMethodType.CARD,
            isDefault: false,
            cardBrand: null,
            cardLast4: null,
            cardExpMonth: null,
            cardExpYear: null,
            bankAccountLast4: null,
            bankName: null,
            stripePaymentMethodId: paymentMethod.stripePaymentMethodId ?? null,
            paypalEmail: paymentMethod.paypalEmail ?? null,
            billingDetails: paymentMethod.billingDetails ?? null,
            isActive: false,
            createdAt: new Date(),
        };
    }
    async setDefaultPaymentMethod(_orgId, _paymentMethodId) { }
    async updatePaymentMethod(_id, orgId, updates) {
        return this.createPaymentMethod({ ...updates, orgId });
    }
    async deletePaymentMethod(_id, _orgId) { }
}
function mapPlanFromDb(row) {
    const featureConfig = row.feature_config ?? {};
    return {
        id: row.id,
        key: row.key,
        version: Number(row.version ?? 1),
        name: row.name,
        description: row.description,
        tier: row.tier,
        isPublic: row.is_public,
        sortOrder: row.sort_order,
        eventLimitMonthly: Number(row.event_limit_monthly),
        hardCap: row.hard_cap,
        priceInrMonthly: row.price_inr_monthly,
        priceUsdMonthly: row.price_usd_monthly,
        priceInrAnnual: row.price_inr_annual,
        priceUsdAnnual: row.price_usd_annual,
        overagePricePer1kInr: row.overage_price_per_1k_inr,
        overagePricePer1kUsd: row.overage_price_per_1k_usd,
        featureConfig,
        basePriceMonthly: Number(row.price_usd_monthly ?? 0),
        basePriceYearly: row.price_usd_annual === null ? null : Number(row.price_usd_annual),
        currency: 'USD',
        billingInterval: BillingInterval.MONTHLY,
        limits: {
            maxProjects: Number(featureConfig.max_projects ?? 0),
            maxMembers: Number(featureConfig.max_team_members ?? 0),
            maxApplications: Number(featureConfig.max_projects ?? 0),
            maxMetricsPerApp: -1,
            dataRetentionDays: Number(featureConfig.log_retention_days ?? 0),
            apiRequestsPerMin: -1,
            alertRules: Number(featureConfig.alert_rules_max ?? 0),
            dashboards: -1,
            integrations: Number(featureConfig.notification_channels_max ?? 0),
            supportLevel: featureConfig.priority_support ? 'priority' : 'standard',
            ssoEnabled: featureConfig.sso_saml === true,
            advancedAnalytics: featureConfig.metrics_collection === true,
            customDomains: 0,
            slaUptime: featureConfig.sla_uptime_guarantee ? 'custom' : 'none',
        },
        features: {
            realTimeAlerts: Number(featureConfig.alert_rules_max ?? 0) !== 0,
            emailNotifications: featureConfig.email_alerts === true,
            slackIntegration: featureConfig.slack_integration === true,
            pagerdutyIntegration: featureConfig.pagerduty_integration === true,
            customWebhooks: Number(featureConfig.custom_webhooks_max ?? 0) !== 0,
            logRetentionExtended: Number(featureConfig.log_retention_days ?? 0) > 7,
            auditLogs: Number(featureConfig.audit_log_retention_days ?? 0) > 7,
            dedicatedSupport: featureConfig.priority_support === true,
            customContract: row.tier === PlanTier.ENTERPRISE,
        },
        trialDays: 7,
        gracePeriodDays: 7,
        isActive: row.is_active,
        deprecatedAt: null,
        replacedBy: null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function prefixColumns(columns, alias) {
    return columns
        .split(',')
        .map((column) => column.trim())
        .filter(Boolean)
        .map((column) => `${alias}.${column}`)
        .join(', ');
}
function mapSubscriptionFromDb(row) {
    return {
        id: row.id,
        orgId: row.org_id,
        planId: row.plan_id,
        status: row.status,
        billingProvider: row.billing_provider,
        providerCustomerId: row.provider_customer_id,
        providerSubscriptionId: row.provider_subscription_id,
        billingInterval: row.billing_interval,
        currentPeriodStart: row.current_period_start,
        currentPeriodEnd: row.current_period_end,
        trialStart: row.trial_start,
        trialEnd: row.trial_end,
        cancelAtPeriodEnd: row.cancel_at_period_end,
        canceledAt: row.canceled_at,
        seats: row.seats,
        billingCycleAnchor: row.current_period_start,
        defaultPaymentMethodId: null,
        paymentMethodType: PaymentMethodType.CARD,
        stripeCustomerId: row.billing_provider === 'stripe' ? row.provider_customer_id : null,
        stripeSubscriptionId: row.billing_provider === 'stripe' ? row.provider_subscription_id : null,
        invoicePrefix: null,
        nextInvoiceNumber: 1,
        invoiceNotes: null,
        netTermsDays: 0,
        usageBillingEnabled: true,
        overageRatePerUnit: null,
        mrr: 0,
        arr: 0,
        totalPaidToDate: 0,
        cancellationReason: null,
        gracePeriodStart: null,
        gracePeriodEnd: null,
        taxExempt: false,
        taxId: null,
        taxRate: 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function mapInvoiceFromDb(row) {
    return {
        id: row.id,
        orgId: row.org_id,
        subscriptionId: row.subscription_id,
        provider: row.provider,
        providerInvoiceId: row.provider_invoice_id,
        invoiceNumber: row.provider_invoice_id,
        status: row.status,
        invoiceDate: row.created_at,
        dueDate: row.period_end,
        paidAt: row.paid_at,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        subtotal: Number(row.amount_due ?? 0),
        discountAmount: 0,
        discountCode: null,
        taxAmount: 0,
        taxRate: 0,
        total: Number(row.amount_due ?? 0),
        amountPaid: Number(row.amount_paid ?? 0),
        amountDue: Number(row.amount_due ?? 0),
        currency: row.currency,
        lineItems: [],
        paymentMethod: null,
        paymentIntentId: null,
        stripeInvoiceId: row.provider === 'stripe' ? row.provider_invoice_id : null,
        pdfUrl: row.pdf_url,
        footerNote: null,
        memo: null,
        overageEvents: Number(row.overage_events ?? 0),
        overageAmount: Number(row.overage_amount ?? 0),
        createdAt: row.created_at,
        updatedAt: row.created_at,
    };
}
function mapUsageRecordFromDb(row, metricType) {
    const usageCount = metricType === UsageMetricType.METRICS_INGESTED
        ? Number(row.ai_analyses_count ?? 0)
        : Number(row.events_count ?? 0);
    return {
        id: row.id,
        orgId: row.org_id,
        projectId: row.project_id,
        metricType,
        metricName: metricType,
        periodStart: row.date,
        periodEnd: row.date,
        granularity: 'daily',
        usageCount,
        usageLimit: null,
        overageCount: 0,
        unitCost: null,
        totalCost: 0,
        details: {
            eventsCount: Number(row.events_count ?? 0),
            aiAnalysesCount: Number(row.ai_analyses_count ?? 0),
        },
        createdAt: row.updated_at,
        updatedAt: row.updated_at,
    };
}
function mapUsageCounterFromDb(row) {
    return {
        orgId: row.org_id,
        currentPeriodStart: row.current_period_start,
        apiRequestsThisPeriod: Number(row.events_count ?? 0),
        metricsIngestedThisPeriod: Number(row.events_count ?? 0),
        storageGbThisPeriod: 0,
        notificationsSentThisPeriod: 0,
        totalApiRequestsAllTime: Number(row.events_count ?? 0),
        totalMetricsIngestedAllTime: Number(row.events_count ?? 0),
        aiAnalysesThisPeriod: Number(row.ai_analyses_count ?? 0),
        lastUpdatedAt: row.last_updated_at,
        limitWarning80SentAt: null,
        limitWarning100SentAt: null,
        updatedAt: row.last_updated_at,
    };
}
function mapCouponFromDb(row) {
    return {
        id: row.id,
        code: row.code,
        description: null,
        discountType: row.discount_type,
        discountValue: Number(row.discount_value),
        currency: null,
        duration: 'once',
        durationInMonths: null,
        maxRedemptions: row.max_redemptions,
        redeemBy: row.valid_until,
        timesRedeemed: row.redemption_count,
        redemptionCount: row.redemption_count,
        validFrom: row.valid_from,
        validUntil: row.valid_until,
        isActive: row.is_active,
        createdAt: row.created_at,
    };
}
function mapQuotaRequestFromDb(row) {
    return {
        id: row.id,
        orgId: row.org_id,
        quotaType: row.quota_type,
        requestedLimit: Number(row.requested_limit),
        currentLimit: Number(row.current_limit),
        reason: row.reason,
        status: row.status,
        reviewedBy: row.reviewed_by,
        reviewedAt: row.reviewed_at,
        notes: row.notes,
        createdAt: row.created_at,
    };
}
//# sourceMappingURL=repository.js.map
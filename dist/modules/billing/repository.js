/**
 * Billing repository.
 *
 * Flow:
 * 1. Read plan, subscription, payment method, invoice, usage, coupon, and quota
 *    data from PostgreSQL.
 * 2. Use optional PoolClient parameters so services can wrap related writes in
 *    transactions.
 * 3. Build dynamic UPDATE and filter queries from trusted internal field maps.
 * 4. Map database rows into billing module domain objects.
 */
import { pool } from '../../config/database.js';
import { PlanTier, BillingInterval, SubscriptionStatus, InvoiceStatus, PaymentMethodType, UsageMetricType } from './types.js';
import { getDefaultPlanLimits, getDefaultPlanFeatures, formatInvoiceNumber, BillingError, BillingErrorCodes, createBillingLogger } from './utils.js';
const logger = createBillingLogger('Repository');
export class BillingRepository {
    pool;
    constructor(poolInstance = pool) {
        this.pool = poolInstance;
    }
    // ============================================
    // TRANSACTION HELPERS
    // ============================================
    async withTransaction(callback) {
        // Shared transaction helper for service workflows that need multiple billing
        // writes to commit atomically.
        const client = await this.pool.connect();
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
    // ============================================
    // BILLING PLANS
    // ============================================
    async getAllPlans(includeHidden = false) {
        const query = includeHidden
            ? 'SELECT * FROM billing_plans WHERE is_active = true ORDER BY sort_order ASC'
            : 'SELECT * FROM billing_plans WHERE is_active = true AND is_public = true ORDER BY sort_order ASC';
        const result = await this.pool.query(query);
        return result.rows.map(this.mapPlanFromDb);
    }
    async getPlanById(planId) {
        const result = await this.pool.query('SELECT * FROM billing_plans WHERE id = $1', [planId]);
        return result.rows.length > 0 ? this.mapPlanFromDb(result.rows[0]) : null;
    }
    async getPlanByTier(tier) {
        const result = await this.pool.query('SELECT * FROM billing_plans WHERE tier = $1 AND is_active = true LIMIT 1', [tier]);
        return result.rows.length > 0 ? this.mapPlanFromDb(result.rows[0]) : null;
    }
    // ============================================
    // ORGANIZATION ACCESS / BILLING PROFILE
    // ============================================
    async getOrganizationById(orgId) {
        const result = await this.pool.query(`SELECT
        id,
        name,
        slug,
        owner_user_id,
        billing_email,
        billing_name,
        billing_address,
        plan_id,
        status,
        deleted_at,
        created_at,
        updated_at
      FROM organizations
      WHERE id = $1 AND deleted_at IS NULL`, [orgId]);
        if (result.rows.length === 0) {
            return null;
        }
        const row = result.rows[0];
        return {
            id: row.id,
            name: row.name,
            slug: row.slug,
            ownerUserId: row.owner_user_id,
            billingEmail: row.billing_email,
            billingName: row.billing_name,
            billingAddress: row.billing_address,
            planId: row.plan_id,
            status: row.status,
            deletedAt: row.deleted_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
    async getOrganizationMembership(orgId, userId) {
        const result = await this.pool.query(`SELECT role, permissions, is_active, joined_at
       FROM organization_members
       WHERE org_id = $1 AND user_id = $2
       LIMIT 1`, [orgId, userId]);
        if (result.rows.length === 0) {
            return null;
        }
        const row = result.rows[0];
        return {
            role: row.role,
            permissions: row.permissions,
            isActive: row.is_active,
            joinedAt: row.joined_at
        };
    }
    async updateOrganizationPlan(orgId, planId, client) {
        const db = client || this.pool;
        await db.query(`UPDATE organizations
       SET plan_id = $1, plan_started_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND deleted_at IS NULL`, [planId, orgId]);
    }
    async updateOrganizationBillingProfile(orgId, updates, client) {
        const db = client || this.pool;
        await db.query(`UPDATE organizations
       SET billing_email = COALESCE($1, billing_email),
           billing_name = COALESCE($2, billing_name),
           billing_address = COALESCE($3, billing_address),
           updated_at = NOW()
       WHERE id = $4 AND deleted_at IS NULL`, [
            updates.billingEmail ?? null,
            updates.billingName ?? null,
            updates.billingAddress ? JSON.stringify(updates.billingAddress) : null,
            orgId
        ]);
    }
    async seedDefaultPlans() {
        // Idempotent seed operation. Existing plans are updated in place so local
        // setup and migrations can run repeatedly.
        const plans = [
            {
                id: 'starter',
                name: 'Starter',
                tier: PlanTier.STARTER,
                basePriceMonthly: 0,
                basePriceYearly: 0,
                limits: {
                    ...getDefaultPlanLimits(),
                    maxProjects: 3,
                    maxMembers: 2,
                    maxApplications: 5,
                    dataRetentionDays: 7,
                    apiRequestsPerMin: 100
                },
                features: {
                    ...getDefaultPlanFeatures(),
                    slackIntegration: false,
                    pagerdutyIntegration: false
                }
            },
            {
                id: 'professional',
                name: 'Professional',
                tier: PlanTier.PROFESSIONAL,
                basePriceMonthly: 29,
                basePriceYearly: 290,
                limits: {
                    ...getDefaultPlanLimits(),
                    maxProjects: 10,
                    maxMembers: 10,
                    maxApplications: 50,
                    maxMetricsPerApp: 500,
                    dataRetentionDays: 90,
                    apiRequestsPerMin: 10000,
                    alertRules: 50,
                    dashboards: 10,
                    integrations: 10,
                    supportLevel: 'email',
                    advancedAnalytics: true,
                    customDomains: 1,
                    slaUptime: '99.9%'
                },
                features: {
                    ...getDefaultPlanFeatures(),
                    slackIntegration: true,
                    customWebhooks: true,
                    logRetentionExtended: true,
                    auditLogs: true
                }
            },
            {
                id: 'enterprise',
                name: 'Enterprise',
                tier: PlanTier.ENTERPRISE,
                basePriceMonthly: 99,
                basePriceYearly: 990,
                limits: {
                    ...getDefaultPlanLimits(),
                    maxProjects: 100,
                    maxMembers: 100,
                    maxApplications: 500,
                    maxMetricsPerApp: 2000,
                    dataRetentionDays: 365,
                    apiRequestsPerMin: 100000,
                    alertRules: 999,
                    dashboards: 100,
                    integrations: 50,
                    supportLevel: 'priority',
                    ssoEnabled: true,
                    advancedAnalytics: true,
                    customDomains: 10,
                    slaUptime: '99.99%'
                },
                features: {
                    ...getDefaultPlanFeatures(),
                    slackIntegration: true,
                    pagerdutyIntegration: true,
                    customWebhooks: true,
                    logRetentionExtended: true,
                    auditLogs: true,
                    dedicatedSupport: true,
                    customContract: true
                }
            }
        ];
        for (const plan of plans) {
            await this.pool.query(`INSERT INTO billing_plans (
          id, name, tier, base_price_monthly, base_price_yearly, 
          limits, features, is_public, sort_order
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          base_price_monthly = EXCLUDED.base_price_monthly,
          base_price_yearly = EXCLUDED.base_price_yearly,
          limits = EXCLUDED.limits,
          features = EXCLUDED.features,
          updated_at = NOW()`, [
                plan.id,
                plan.name,
                plan.tier,
                plan.basePriceMonthly,
                plan.basePriceYearly,
                JSON.stringify(plan.limits),
                JSON.stringify(plan.features),
                plans.indexOf(plan)
            ]);
        }
        logger.info('Default plans seeded successfully');
    }
    mapPlanFromDb(row) {
        return {
            id: row.id,
            name: row.name,
            description: row.description,
            tier: row.tier,
            isPublic: row.is_public,
            sortOrder: row.sort_order,
            basePriceMonthly: parseFloat(row.base_price_monthly),
            basePriceYearly: row.base_price_yearly ? parseFloat(row.base_price_yearly) : null,
            currency: row.currency,
            billingInterval: row.billing_interval,
            limits: row.limits,
            features: row.features,
            trialDays: row.trial_days,
            gracePeriodDays: row.grace_period_days,
            isActive: row.is_active,
            deprecatedAt: row.deprecated_at,
            replacedBy: row.replaced_by,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
    // ============================================
    // ORGANIZATION BILLING (SUBSCRIPTIONS)
    // ============================================
    async getOrganizationBilling(orgId) {
        const result = await this.pool.query('SELECT * FROM organization_billing WHERE org_id = $1', [orgId]);
        return result.rows.length > 0 ? this.mapBillingFromDb(result.rows[0]) : null;
    }
    async createOrganizationBilling(billing, client) {
        const db = client || this.pool;
        const result = await db.query(`INSERT INTO organization_billing (
        org_id, plan_id, status, current_period_start, current_period_end,
        billing_cycle_anchor, default_payment_method_id, payment_method_type,
        stripe_customer_id, stripe_subscription_id, mrr, tax_rate
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`, [
            billing.orgId,
            billing.planId,
            billing.status || SubscriptionStatus.TRIALING,
            billing.currentPeriodStart,
            billing.currentPeriodEnd,
            billing.billingCycleAnchor,
            billing.defaultPaymentMethodId,
            billing.paymentMethodType || PaymentMethodType.CARD,
            billing.stripeCustomerId,
            billing.stripeSubscriptionId,
            billing.mrr || 0,
            billing.taxRate || 0
        ]);
        return this.mapBillingFromDb(result.rows[0]);
    }
    async updateOrganizationBilling(orgId, updates, client) {
        // Dynamic update keeps PATCH semantics for billing profiles. Only supplied
        // fields are changed, and updated_at is always refreshed.
        const db = client || this.pool;
        const setClauses = [];
        const values = [];
        let paramIndex = 1;
        if (updates.planId !== undefined) {
            setClauses.push(`plan_id = $${paramIndex++}`);
            values.push(updates.planId);
        }
        if (updates.status !== undefined) {
            setClauses.push(`status = $${paramIndex++}`);
            values.push(updates.status);
        }
        if (updates.currentPeriodEnd !== undefined) {
            setClauses.push(`current_period_end = $${paramIndex++}`);
            values.push(updates.currentPeriodEnd);
        }
        if (updates.defaultPaymentMethodId !== undefined) {
            setClauses.push(`default_payment_method_id = $${paramIndex++}`);
            values.push(updates.defaultPaymentMethodId);
        }
        if (updates.mrr !== undefined) {
            setClauses.push(`mrr = $${paramIndex++}`);
            values.push(updates.mrr);
        }
        if (updates.cancelAtPeriodEnd !== undefined) {
            setClauses.push(`cancel_at_period_end = $${paramIndex++}`);
            values.push(updates.cancelAtPeriodEnd);
        }
        if (updates.canceledAt !== undefined) {
            setClauses.push(`canceled_at = $${paramIndex++}`);
            values.push(updates.canceledAt);
        }
        if (updates.cancellationReason !== undefined) {
            setClauses.push(`cancellation_reason = $${paramIndex++}`);
            values.push(updates.cancellationReason);
        }
        if (updates.totalPaidToDate !== undefined) {
            setClauses.push(`total_paid_to_date = $${paramIndex++}`);
            values.push(updates.totalPaidToDate);
        }
        if (updates.invoicePrefix !== undefined) {
            setClauses.push(`invoice_prefix = $${paramIndex++}`);
            values.push(updates.invoicePrefix);
        }
        if (updates.nextInvoiceNumber !== undefined) {
            setClauses.push(`next_invoice_number = $${paramIndex++}`);
            values.push(updates.nextInvoiceNumber);
        }
        if (updates.invoiceNotes !== undefined) {
            setClauses.push(`invoice_notes = $${paramIndex++}`);
            values.push(updates.invoiceNotes);
        }
        if (updates.netTermsDays !== undefined) {
            setClauses.push(`net_terms_days = $${paramIndex++}`);
            values.push(updates.netTermsDays);
        }
        if (updates.usageBillingEnabled !== undefined) {
            setClauses.push(`usage_billing_enabled = $${paramIndex++}`);
            values.push(updates.usageBillingEnabled);
        }
        if (updates.overageRatePerUnit !== undefined) {
            setClauses.push(`overage_rate_per_unit = $${paramIndex++}`);
            values.push(updates.overageRatePerUnit);
        }
        if (updates.taxExempt !== undefined) {
            setClauses.push(`tax_exempt = $${paramIndex++}`);
            values.push(updates.taxExempt);
        }
        if (updates.taxId !== undefined) {
            setClauses.push(`tax_id = $${paramIndex++}`);
            values.push(updates.taxId);
        }
        if (updates.taxRate !== undefined) {
            setClauses.push(`tax_rate = $${paramIndex++}`);
            values.push(updates.taxRate);
        }
        setClauses.push(`updated_at = NOW()`);
        values.push(orgId);
        const query = `
      UPDATE organization_billing 
      SET ${setClauses.join(', ')}
      WHERE org_id = $${paramIndex}
      RETURNING *
    `;
        const result = await db.query(query, values);
        return this.mapBillingFromDb(result.rows[0]);
    }
    async updateSubscriptionStatus(orgId, status, client) {
        const db = client || this.pool;
        await db.query('UPDATE organization_billing SET status = $1, updated_at = NOW() WHERE org_id = $2', [status, orgId]);
    }
    mapBillingFromDb(row) {
        return {
            id: row.id,
            orgId: row.org_id,
            planId: row.plan_id,
            status: row.status,
            currentPeriodStart: row.current_period_start,
            currentPeriodEnd: row.current_period_end,
            billingCycleAnchor: row.billing_cycle_anchor,
            defaultPaymentMethodId: row.default_payment_method_id,
            paymentMethodType: row.payment_method_type,
            stripeCustomerId: row.stripe_customer_id,
            stripeSubscriptionId: row.stripe_subscription_id,
            invoicePrefix: row.invoice_prefix,
            nextInvoiceNumber: row.next_invoice_number,
            invoiceNotes: row.invoice_notes,
            netTermsDays: row.net_terms_days,
            usageBillingEnabled: row.usage_billing_enabled,
            overageRatePerUnit: row.overage_rate_per_unit ? parseFloat(row.overage_rate_per_unit) : null,
            mrr: parseFloat(row.mrr),
            arr: parseFloat(row.arr),
            totalPaidToDate: parseFloat(row.total_paid_to_date),
            cancelAtPeriodEnd: row.cancel_at_period_end,
            canceledAt: row.canceled_at,
            cancellationReason: row.cancellation_reason,
            gracePeriodStart: row.grace_period_start,
            gracePeriodEnd: row.grace_period_end,
            taxExempt: row.tax_exempt,
            taxId: row.tax_id,
            taxRate: parseFloat(row.tax_rate),
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
    // ============================================
    // PAYMENT METHODS
    // ============================================
    async getPaymentMethods(orgId) {
        const result = await this.pool.query('SELECT * FROM organization_payment_methods WHERE org_id = $1 AND is_active = true ORDER BY is_default DESC, created_at DESC', [orgId]);
        return result.rows.map(this.mapPaymentMethodFromDb);
    }
    async getPaymentMethodById(id, orgId) {
        const result = await this.pool.query('SELECT * FROM organization_payment_methods WHERE id = $1 AND org_id = $2', [id, orgId]);
        return result.rows.length > 0 ? this.mapPaymentMethodFromDb(result.rows[0]) : null;
    }
    async getDefaultPaymentMethod(orgId) {
        const result = await this.pool.query('SELECT * FROM organization_payment_methods WHERE org_id = $1 AND is_default = true AND is_active = true LIMIT 1', [orgId]);
        return result.rows.length > 0 ? this.mapPaymentMethodFromDb(result.rows[0]) : null;
    }
    async createPaymentMethod(paymentMethod, client) {
        // First active payment method becomes default automatically to keep checkout
        // and invoice payment flows usable without a second request.
        const db = client || this.pool;
        // If this is the first payment method, make it default
        const existingCount = await db.query('SELECT COUNT(*) FROM organization_payment_methods WHERE org_id = $1 AND is_active = true', [paymentMethod.orgId]);
        const isDefault = parseInt(existingCount.rows[0].count) === 0 || paymentMethod.isDefault;
        const result = await db.query(`INSERT INTO organization_payment_methods (
        org_id, type, is_default, card_brand, card_last4, card_exp_month, card_exp_year,
        bank_account_last4, bank_name, stripe_payment_method_id, paypal_email, billing_details
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`, [
            paymentMethod.orgId,
            paymentMethod.type,
            isDefault,
            paymentMethod.cardBrand,
            paymentMethod.cardLast4,
            paymentMethod.cardExpMonth,
            paymentMethod.cardExpYear,
            paymentMethod.bankAccountLast4,
            paymentMethod.bankName,
            paymentMethod.stripePaymentMethodId,
            paymentMethod.paypalEmail,
            paymentMethod.billingDetails ? JSON.stringify(paymentMethod.billingDetails) : null
        ]);
        return this.mapPaymentMethodFromDb(result.rows[0]);
    }
    async setDefaultPaymentMethod(orgId, paymentMethodId, client) {
        const db = client || this.pool;
        await db.query('UPDATE organization_payment_methods SET is_default = false WHERE org_id = $1', [orgId]);
        await db.query('UPDATE organization_payment_methods SET is_default = true WHERE id = $1 AND org_id = $2', [paymentMethodId, orgId]);
    }
    async updatePaymentMethod(id, orgId, updates) {
        const result = await this.pool.query(`UPDATE organization_payment_methods SET
        billing_details = COALESCE($1, billing_details),
        is_active = COALESCE($2, is_active),
        updated_at = NOW()
      WHERE id = $3 AND org_id = $4
      RETURNING *`, [
            updates.billingDetails ? JSON.stringify(updates.billingDetails) : null,
            updates.isActive,
            id,
            orgId
        ]);
        return this.mapPaymentMethodFromDb(result.rows[0]);
    }
    async deletePaymentMethod(id, orgId) {
        await this.pool.query('UPDATE organization_payment_methods SET is_active = false, updated_at = NOW() WHERE id = $1 AND org_id = $2', [id, orgId]);
    }
    mapPaymentMethodFromDb(row) {
        return {
            id: row.id,
            orgId: row.org_id,
            type: row.type,
            isDefault: row.is_default,
            cardBrand: row.card_brand,
            cardLast4: row.card_last4,
            cardExpMonth: row.card_exp_month,
            cardExpYear: row.card_exp_year,
            bankAccountLast4: row.bank_account_last4,
            bankName: row.bank_name,
            stripePaymentMethodId: row.stripe_payment_method_id,
            paypalEmail: row.paypal_email,
            billingDetails: row.billing_details,
            isActive: row.is_active,
            createdAt: row.created_at
        };
    }
    // ============================================
    // INVOICES
    // ============================================
    async getInvoices(orgId, options = {}) {
        let whereClause = 'WHERE org_id = $1';
        const values = [orgId];
        let paramIndex = 2;
        if (options.status) {
            whereClause += ` AND status = $${paramIndex++}`;
            values.push(options.status);
        }
        if (options.startDate) {
            whereClause += ` AND invoice_date >= $${paramIndex++}`;
            values.push(options.startDate);
        }
        if (options.endDate) {
            whereClause += ` AND invoice_date <= $${paramIndex++}`;
            values.push(options.endDate);
        }
        const countResult = await this.pool.query(`SELECT COUNT(*) FROM organization_invoices ${whereClause}`, values);
        const total = parseInt(countResult.rows[0].count);
        let query = `SELECT * FROM organization_invoices ${whereClause} ORDER BY invoice_date DESC`;
        if (options.limit) {
            query += ` LIMIT $${paramIndex++}`;
            values.push(options.limit);
        }
        if (options.offset) {
            query += ` OFFSET $${paramIndex++}`;
            values.push(options.offset);
        }
        const result = await this.pool.query(query, values);
        return {
            invoices: result.rows.map(this.mapInvoiceFromDb),
            total
        };
    }
    async getInvoiceById(id, orgId) {
        const result = await this.pool.query('SELECT * FROM organization_invoices WHERE id = $1 AND org_id = $2', [id, orgId]);
        return result.rows.length > 0 ? this.mapInvoiceFromDb(result.rows[0]) : null;
    }
    async getInvoiceByNumber(invoiceNumber, orgId) {
        const result = await this.pool.query('SELECT * FROM organization_invoices WHERE invoice_number = $1 AND org_id = $2', [invoiceNumber, orgId]);
        return result.rows.length > 0 ? this.mapInvoiceFromDb(result.rows[0]) : null;
    }
    async createInvoice(invoice, client) {
        // Invoice number generation locks the billing row with FOR UPDATE so two
        // invoice writers cannot reuse the same invoice number.
        const db = client || this.pool;
        // Generate invoice number
        const billing = await db.query('SELECT invoice_prefix, next_invoice_number FROM organization_billing WHERE org_id = $1 FOR UPDATE', [invoice.orgId]);
        const prefix = billing.rows[0]?.invoice_prefix || 'INV';
        const number = billing.rows[0]?.next_invoice_number || 1;
        const invoiceNumber = formatInvoiceNumber(prefix, number);
        // Increment invoice number
        await db.query('UPDATE organization_billing SET next_invoice_number = next_invoice_number + 1 WHERE org_id = $1', [invoice.orgId]);
        const result = await db.query(`INSERT INTO organization_invoices (
        org_id, invoice_number, status, invoice_date, due_date,
        period_start, period_end, subtotal, discount_amount, discount_code,
        tax_amount, tax_rate, total, currency, line_items, payment_method
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`, [
            invoice.orgId,
            invoiceNumber,
            invoice.status || InvoiceStatus.DRAFT,
            invoice.invoiceDate,
            invoice.dueDate,
            invoice.periodStart,
            invoice.periodEnd,
            invoice.subtotal,
            invoice.discountAmount || 0,
            invoice.discountCode,
            invoice.taxAmount || 0,
            invoice.taxRate || 0,
            invoice.total,
            invoice.currency || 'USD',
            JSON.stringify(invoice.lineItems || []),
            invoice.paymentMethod
        ]);
        return this.mapInvoiceFromDb(result.rows[0]);
    }
    async updateInvoiceStatus(id, status, paymentDetails, client) {
        const db = client || this.pool;
        let query = 'UPDATE organization_invoices SET status = $1';
        const values = [status];
        let paramIndex = 2;
        if (paymentDetails) {
            query += `, paid_at = $${paramIndex++}, payment_intent_id = $${paramIndex++}, amount_paid = $${paramIndex++}`;
            values.push(paymentDetails.paidAt, paymentDetails.paymentIntentId, paymentDetails.amountPaid);
        }
        query += `, updated_at = NOW() WHERE id = $${paramIndex} RETURNING *`;
        values.push(id);
        const result = await db.query(query, values);
        return this.mapInvoiceFromDb(result.rows[0]);
    }
    async getUpcomingInvoice(orgId) {
        const billing = await this.getOrganizationBilling(orgId);
        if (!billing)
            return null;
        const plan = await this.getPlanById(billing.planId);
        if (!plan)
            return null;
        // Calculate upcoming invoice based on current period
        const periodStart = billing.currentPeriodEnd;
        const periodEnd = new Date(periodStart);
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        const subtotal = billing.mrr;
        const taxAmount = (subtotal * billing.taxRate) / 100;
        const total = subtotal + taxAmount;
        return {
            orgId,
            status: InvoiceStatus.DRAFT,
            periodStart,
            periodEnd,
            subtotal,
            taxAmount,
            taxRate: billing.taxRate,
            total,
            currency: 'USD',
            lineItems: [{
                    description: `${plan.name} - Monthly Subscription`,
                    amount: subtotal,
                    quantity: 1,
                    unitPrice: subtotal,
                    type: 'plan'
                }]
        };
    }
    mapInvoiceFromDb(row) {
        return {
            id: row.id,
            orgId: row.org_id,
            invoiceNumber: row.invoice_number,
            status: row.status,
            invoiceDate: row.invoice_date,
            dueDate: row.due_date,
            paidAt: row.paid_at,
            periodStart: row.period_start,
            periodEnd: row.period_end,
            subtotal: parseFloat(row.subtotal),
            discountAmount: parseFloat(row.discount_amount),
            discountCode: row.discount_code,
            taxAmount: parseFloat(row.tax_amount),
            taxRate: parseFloat(row.tax_rate),
            total: parseFloat(row.total),
            amountPaid: parseFloat(row.amount_paid),
            amountDue: parseFloat(row.amount_due),
            currency: row.currency,
            lineItems: row.line_items,
            paymentMethod: row.payment_method,
            paymentIntentId: row.payment_intent_id,
            stripeInvoiceId: row.stripe_invoice_id,
            pdfUrl: row.pdf_url,
            footerNote: row.footer_note,
            memo: row.memo,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
    // ============================================
    // USAGE RECORDS
    // ============================================
    async recordUsage(usage, client) {
        const db = client || this.pool;
        const result = await db.query(`INSERT INTO organization_usage (
        org_id, metric_type, metric_name, period_start, period_end,
        granularity, usage_count, usage_limit, unit_cost, details
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (org_id, metric_type, period_start, granularity) 
      DO UPDATE SET
        usage_count = organization_usage.usage_count + EXCLUDED.usage_count,
        updated_at = NOW()
      RETURNING *`, [
            usage.orgId,
            usage.metricType,
            usage.metricName,
            usage.periodStart,
            usage.periodEnd,
            usage.granularity || 'daily',
            usage.usageCount,
            usage.usageLimit,
            usage.unitCost,
            usage.details ? JSON.stringify(usage.details) : null
        ]);
        return this.mapUsageRecordFromDb(result.rows[0]);
    }
    async getUsageRecords(orgId, options = {}) {
        // Usage filters are optional and additive, enabling summary and drill-down
        // queries from the same method.
        let whereClause = 'WHERE org_id = $1';
        const values = [orgId];
        let paramIndex = 2;
        if (options.metricType) {
            whereClause += ` AND metric_type = $${paramIndex++}`;
            values.push(options.metricType);
        }
        if (options.startDate) {
            whereClause += ` AND period_start >= $${paramIndex++}`;
            values.push(options.startDate);
        }
        if (options.endDate) {
            whereClause += ` AND period_end <= $${paramIndex++}`;
            values.push(options.endDate);
        }
        if (options.granularity) {
            whereClause += ` AND granularity = $${paramIndex++}`;
            values.push(options.granularity);
        }
        const result = await this.pool.query(`SELECT * FROM organization_usage ${whereClause} ORDER BY period_start DESC`, values);
        return result.rows.map(this.mapUsageRecordFromDb);
    }
    async getUsageCounter(orgId) {
        const result = await this.pool.query('SELECT * FROM organization_usage_counters WHERE org_id = $1', [orgId]);
        return result.rows.length > 0 ? this.mapUsageCounterFromDb(result.rows[0]) : null;
    }
    async incrementUsageCounter(orgId, metric, amount = 1, client) {
        // Metric names are mapped to trusted columns before SQL is built. Unknown
        // metric keys fail fast instead of producing unsafe SQL.
        const db = client || this.pool;
        const columnMap = {
            apiRequestsThisPeriod: 'api_requests_this_period',
            metricsIngestedThisPeriod: 'metrics_ingested_this_period',
            storageGbThisPeriod: 'storage_gb_this_period',
            notificationsSentThisPeriod: 'notifications_sent_this_period',
            totalApiRequestsAllTime: 'total_api_requests_all_time',
            totalMetricsIngestedAllTime: 'total_metrics_ingested_all_time'
        };
        const column = columnMap[metric];
        if (!column)
            throw new Error(`Unknown metric: ${metric}`);
        await db.query(`INSERT INTO organization_usage_counters (org_id, current_period_start, ${column})
      VALUES ($1, DATE_TRUNC('month', NOW()), $2)
      ON CONFLICT (org_id) 
      DO UPDATE SET
        ${column} = organization_usage_counters.${column} + EXCLUDED.${column},
        last_updated_at = NOW(),
        updated_at = NOW()`, [orgId, amount]);
    }
    mapUsageRecordFromDb(row) {
        return {
            id: row.id,
            orgId: row.org_id,
            metricType: row.metric_type,
            metricName: row.metric_name,
            periodStart: row.period_start,
            periodEnd: row.period_end,
            granularity: row.granularity,
            usageCount: parseInt(row.usage_count),
            usageLimit: row.usage_limit ? parseInt(row.usage_limit) : null,
            overageCount: parseInt(row.overage_count),
            unitCost: row.unit_cost ? parseFloat(row.unit_cost) : null,
            totalCost: parseFloat(row.total_cost),
            details: row.details,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
    mapUsageCounterFromDb(row) {
        return {
            orgId: row.org_id,
            currentPeriodStart: row.current_period_start,
            apiRequestsThisPeriod: parseInt(row.api_requests_this_period),
            metricsIngestedThisPeriod: parseInt(row.metrics_ingested_this_period),
            storageGbThisPeriod: parseFloat(row.storage_gb_this_period),
            notificationsSentThisPeriod: parseInt(row.notifications_sent_this_period),
            totalApiRequestsAllTime: parseInt(row.total_api_requests_all_time),
            totalMetricsIngestedAllTime: parseInt(row.total_metrics_ingested_all_time),
            lastUpdatedAt: row.last_updated_at,
            limitWarning80SentAt: row.limit_warning_80_sent_at,
            limitWarning100SentAt: row.limit_warning_100_sent_at,
            updatedAt: row.updated_at
        };
    }
    // ============================================
    // COUPONS
    // ============================================
    async getCouponByCode(code) {
        const result = await this.pool.query('SELECT * FROM coupons WHERE code = $1 AND is_active = true', [code.toUpperCase()]);
        return result.rows.length > 0 ? this.mapCouponFromDb(result.rows[0]) : null;
    }
    async incrementCouponUsage(code, client) {
        const db = client || this.pool;
        await db.query('UPDATE coupons SET times_redeemed = times_redeemed + 1 WHERE code = $1', [code.toUpperCase()]);
    }
    mapCouponFromDb(row) {
        return {
            id: row.id,
            code: row.code,
            description: row.description,
            discountType: row.discount_type,
            discountValue: parseFloat(row.discount_value),
            currency: row.currency,
            duration: row.duration,
            durationInMonths: row.duration_in_months,
            maxRedemptions: row.max_redemptions,
            redeemBy: row.redeem_by,
            timesRedeemed: row.times_redeemed,
            isActive: row.is_active,
            createdAt: row.created_at
        };
    }
    // ============================================
    // QUOTA REQUESTS
    // ============================================
    async createQuotaRequest(request) {
        const result = await this.pool.query(`INSERT INTO quota_requests (org_id, quota_type, requested_limit, current_limit, reason)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *`, [
            request.orgId,
            request.quotaType,
            request.requestedLimit,
            request.currentLimit,
            request.reason
        ]);
        return this.mapQuotaRequestFromDb(result.rows[0]);
    }
    async getQuotaRequests(orgId) {
        const result = await this.pool.query('SELECT * FROM quota_requests WHERE org_id = $1 ORDER BY created_at DESC', [orgId]);
        return result.rows.map(this.mapQuotaRequestFromDb);
    }
    mapQuotaRequestFromDb(row) {
        return {
            id: row.id,
            orgId: row.org_id,
            quotaType: row.quota_type,
            requestedLimit: row.requested_limit,
            currentLimit: row.current_limit,
            reason: row.reason,
            status: row.status,
            reviewedBy: row.reviewed_by,
            reviewedAt: row.reviewed_at,
            notes: row.notes,
            createdAt: row.created_at
        };
    }
}
//# sourceMappingURL=repository.js.map
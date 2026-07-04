/**
 * Billing routes for Fastify.
 *
 * Flow:
 * 1. Resolve organization context from authenticated user data or x-org-id.
 * 2. Delegate pricing, subscription, payment-method, invoice, usage, quota, and
 *    portal operations to BillingService.
 * 3. Convert BillingError instances into stable API responses.
 *
 * Webhook endpoints intentionally skip authenticate because payment providers
 * call them directly; provider signature validation belongs in the service.
 */
import { ZodError } from 'zod';
import { BillingInterval, UsageMetricType, InvoiceStatus, AddPaymentMethodSchema, ApplyCouponSchema, BillingAddressSchema, BillingEmailSchema, CancelSubscriptionSchema, ChangeIntervalSchema, ChangePlanSchema, CheckoutSessionSchema, CreateSubscriptionSchema, CreditsSchema, EstimatePricingSchema, IdParamsSchema, ListInvoicesQuerySchema, PlanIdParamsSchema, PreviewChangeSchema, ProviderParamsSchema, QuotaIncreaseSchema, QuotaTypeParamsSchema, TaxSettingsSchema, UpdateBillingSettingsSchema, UsageExportQuerySchema, UsageHistoryQuerySchema, UsageQuerySchema, WaiveInvoiceSchema } from './types.js';
import { BillingError, BillingErrorCodes } from './utils.js';
import { authenticate } from '../../shared/middleware/auth.js';
export async function billingRoutes(fastify, options) {
    // Billing service is supplied by the billing module decorator. Routes keep the
    // HTTP surface area grouped by billing domain.
    const service = fastify.billing.service;
    // ============================================
    // PLANS & PRICING
    // ============================================
    fastify.get('/plans', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.listPlans();
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.get('/plans/public', async (request, reply) => {
        try {
            const result = await service.listPlans();
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.get('/plans/:planId', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { planId } = PlanIdParamsSchema.parse(request.params);
            const result = await service.getPlan(planId);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.get('/plans/compare', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.comparePlans();
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.post('/plans/estimate', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { planId, interval, couponCode } = EstimatePricingSchema.parse(request.body);
            const result = await service.estimatePricing(planId, interval, couponCode);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    // ============================================
    // SUBSCRIPTION MANAGEMENT
    // ============================================
    fastify.get('/subscription', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.getSubscription(getOrgId(request));
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.get('/subscription/history', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.getSubscriptionHistory(getOrgId(request));
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.get('/subscription/usage', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.getCurrentUsage(getOrgId(request));
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.get('/subscription/invoices', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.listInvoices(getOrgId(request), {});
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.post('/subscription', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const body = CreateSubscriptionSchema.parse(request.body);
            const result = await service.createSubscription(getOrgId(request), body);
            return reply.code(201).send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.post('/subscription/start-trial', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const body = CreateSubscriptionSchema.parse(request.body);
            const result = await service.createSubscription(getOrgId(request), body);
            return reply.code(201).send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.post('/subscription/checkout', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { planId } = CheckoutSessionSchema.parse(request.body);
            const result = await service.createCheckoutSession(getOrgId(request), planId);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.patch('/subscription/plan', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const body = ChangePlanSchema.parse(request.body);
            const result = await service.changePlan(getOrgId(request), body);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    for (const path of ['/subscription/change-plan', '/subscription/upgrade', '/subscription/downgrade']) {
        fastify.post(path, {
            preHandler: [authenticate],
        }, async (request, reply) => {
            try {
                const body = ChangePlanSchema.parse(request.body);
                const result = await service.changePlan(getOrgId(request), body);
                return reply.send(result);
            }
            catch (error) {
                return handleBillingError(error, reply);
            }
        });
    }
    fastify.post('/subscription/change-interval', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { interval } = ChangeIntervalSchema.parse(request.body);
            const result = await service.changeInterval(getOrgId(request), interval);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.post('/subscription/cancel', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const body = CancelSubscriptionSchema.parse(request.body);
            const result = await service.cancelSubscription(getOrgId(request), body);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.post('/subscription/reactivate', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.reactivateSubscription(getOrgId(request));
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.post('/subscription/resume', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.reactivateSubscription(getOrgId(request));
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.post('/subscription/preview-change', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { newPlanId } = PreviewChangeSchema.parse(request.body);
            const result = await service.previewProration(getOrgId(request), newPlanId);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    for (const path of ['/subscription/preview-upgrade', '/subscription/preview-downgrade']) {
        fastify.post(path, {
            preHandler: [authenticate],
        }, async (request, reply) => {
            try {
                const { newPlanId } = PreviewChangeSchema.parse(request.body);
                const result = await service.previewProration(getOrgId(request), newPlanId);
                return reply.send(result);
            }
            catch (error) {
                return handleBillingError(error, reply);
            }
        });
    }
    fastify.post('/subscription/apply-coupon', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { code } = ApplyCouponSchema.parse(request.body);
            const result = await service.applyCoupon(getOrgId(request), code);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.delete('/subscription/remove-coupon', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.removeCoupon(getOrgId(request));
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    // ============================================
    // PAYMENT METHODS
    // ============================================
    fastify.get('/payment-methods', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.listPaymentMethods(getOrgId(request));
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.post('/payment-methods', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const body = AddPaymentMethodSchema.parse(request.body);
            const result = await service.addPaymentMethod(getOrgId(request), body);
            return reply.code(201).send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.patch('/payment-methods/:id/default', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { id } = IdParamsSchema.parse(request.params);
            const result = await service.setDefaultPaymentMethod(getOrgId(request), id);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.patch('/payment-methods/:id', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { id } = IdParamsSchema.parse(request.params);
            const updates = request.body;
            const result = await service.updatePaymentMethod(id, getOrgId(request), updates);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.delete('/payment-methods/:id', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { id } = IdParamsSchema.parse(request.params);
            const result = await service.removePaymentMethod(id, getOrgId(request));
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.post('/payment-methods/:id/verify', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { id } = IdParamsSchema.parse(request.params);
            const result = await service.verifyPaymentMethod(id, getOrgId(request));
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    // ============================================
    // INVOICES
    // ============================================
    fastify.get('/invoices', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const query = ListInvoicesQuerySchema.parse(request.query);
            const options = {};
            if (query.status)
                options.status = query.status;
            if (query.limit !== undefined)
                options.limit = query.limit;
            if (query.page !== undefined)
                options.offset = (query.page - 1) * (query.limit || 10);
            if (query.startDate)
                options.startDate = new Date(query.startDate);
            if (query.endDate)
                options.endDate = new Date(query.endDate);
            const result = await service.listInvoices(getOrgId(request), options);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.post('/invoices/sync', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.forceSyncBilling(getOrgId(request));
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.get('/invoices/:id', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { id } = IdParamsSchema.parse(request.params);
            const result = await service.getInvoice(id, getOrgId(request));
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.get('/invoices/:id/pdf', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { id } = IdParamsSchema.parse(request.params);
            const result = await service.downloadInvoicePdf(id, getOrgId(request));
            if (result.data) {
                return reply.redirect(result.data);
            }
            return reply.code(404).send({ success: false, error: { message: 'PDF not available' } });
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.post('/invoices/:id/pay', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { id } = IdParamsSchema.parse(request.params);
            const result = await service.payInvoice(id, getOrgId(request));
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.get('/invoices/upcoming', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.getUpcomingInvoice(getOrgId(request));
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    // ============================================
    // USAGE & METERING
    // ============================================
    fastify.get('/usage', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.getCurrentUsage(getOrgId(request));
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.get('/usage/current', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.getCurrentUsage(getOrgId(request));
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.get('/usage/monthly', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.getDetailedUsage(getOrgId(request), { granularity: 'daily' });
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.get('/usage/projects', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.getDetailedUsage(getOrgId(request), { granularity: 'daily' });
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.get('/usage/limits', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.getQuotaStatus(getOrgId(request));
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.get('/usage/detailed', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const query = UsageQuerySchema.parse(request.query);
            const result = await service.getDetailedUsage(getOrgId(request), query);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.get('/usage/history', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { type } = UsageHistoryQuerySchema.parse(request.query);
            const result = await service.getUsageHistory(getOrgId(request), type);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.get('/usage/forecast', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.getUsageForecast(getOrgId(request));
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.get('/usage/export', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { format } = UsageExportQuerySchema.parse(request.query);
            const result = await service.exportUsageReport(getOrgId(request), format);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    // ============================================
    // QUOTAS
    // ============================================
    fastify.get('/quotas', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.getQuotaStatus(getOrgId(request));
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.get('/quotas/:type', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { type } = QuotaTypeParamsSchema.parse(request.params);
            const result = await service.getQuotaDetails(getOrgId(request), type);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.post('/quotas/:type/increase', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { type } = QuotaTypeParamsSchema.parse(request.params);
            const body = QuotaIncreaseSchema.parse(request.body);
            const result = await service.requestQuotaIncrease(getOrgId(request), type, body);
            return reply.code(201).send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.get('/quotas/requests', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.listQuotaRequests(getOrgId(request));
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    // ============================================
    // BILLING SETTINGS
    // ============================================
    fastify.get('/settings', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.getBillingSettings(getOrgId(request));
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.patch('/settings', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const body = UpdateBillingSettingsSchema.parse(request.body);
            const result = await service.updateBillingSettings(getOrgId(request), body);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.patch('/settings/email', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { email } = BillingEmailSchema.parse(request.body);
            const result = await service.updateBillingEmail(getOrgId(request), email);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.patch('/settings/address', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { address } = BillingAddressSchema.parse(request.body);
            const result = await service.updateBillingAddress(getOrgId(request), address);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.patch('/settings/tax', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { taxId } = TaxSettingsSchema.parse(request.body);
            const result = await service.updateTaxSettings(getOrgId(request), taxId);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    // ============================================
    // COUPONS & PROMOTIONS
    // ============================================
    fastify.post('/coupons/apply', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { code } = ApplyCouponSchema.parse(request.body);
            const result = await service.applyCoupon(getOrgId(request), code);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.delete('/coupons', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.removeCoupon(getOrgId(request));
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.post('/coupons/validate', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { code } = ApplyCouponSchema.parse(request.body);
            const result = await service.validateCoupon(code);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.get('/promotions', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.listPromotions();
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    // ============================================
    // WEBHOOKS
    // ============================================
    fastify.post('/webhooks/stripe', async (request, reply) => {
        try {
            const payload = request.body;
            const signature = request.headers['stripe-signature'];
            const result = await service.handleStripeWebhook(payload, signature);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.post('/webhooks/razorpay', async (request, reply) => {
        try {
            const payload = request.body;
            const result = await service.handlePaymentWebhook('razorpay', payload);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.post('/webhooks/:provider', async (request, reply) => {
        try {
            const { provider } = ProviderParamsSchema.parse(request.params);
            const payload = request.body;
            const result = await service.handlePaymentWebhook(provider, payload);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    // ============================================
    // ADMIN OPERATIONS
    // ============================================
    fastify.post('/admin/sync', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.forceSyncBilling(getOrgId(request));
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.post('/admin/override', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const updates = request.body;
            const result = await service.adminOverrideSubscription(getOrgId(request), updates);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.post('/admin/credits', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { amount, reason } = CreditsSchema.parse(request.body);
            const result = await service.grantComplimentaryCredits(getOrgId(request), amount, reason);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.post('/admin/invoices/:id/waive', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { id } = IdParamsSchema.parse(request.params);
            const { reason } = WaiveInvoiceSchema.parse(request.body);
            const result = await service.waiveInvoice(id, getOrgId(request), reason);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.get('/admin/analytics', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const filters = request.query;
            const result = await service.getBillingAnalytics(filters);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    // ============================================
    // PORTAL & CHECKOUT
    // ============================================
    fastify.post('/portal/session', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.createPortalSession(getOrgId(request));
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.get('/stripe/customer-portal', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.createPortalSession(getOrgId(request));
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.post('/checkout/session', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { planId } = CheckoutSessionSchema.parse(request.body);
            const result = await service.createCheckoutSession(getOrgId(request), planId);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.post('/stripe/create-checkout-session', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { planId } = CheckoutSessionSchema.parse(request.body);
            const result = await service.createCheckoutSession(getOrgId(request), planId);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.post('/razorpay/create-order', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const { planId } = CheckoutSessionSchema.parse(request.body);
            const result = await service.createCheckoutSession(getOrgId(request), planId);
            return reply.send({ ...result, data: { ...result.data, provider: 'razorpay' } });
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
    fastify.post('/razorpay/verify-payment', {
        preHandler: [authenticate],
    }, async (request, reply) => {
        try {
            const result = await service.handlePaymentWebhook('razorpay', request.body);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    });
}
// ============================================
// ERROR HANDLER
// ============================================
function handleBillingError(error, reply) {
    // BillingError carries client-safe status, code, message, and optional details.
    // Unknown errors are logged and collapsed into a generic 500 response.
    if (error instanceof ZodError) {
        return reply.code(400).send({
            success: false,
            error: {
                code: BillingErrorCodes.VALIDATION_ERROR,
                message: 'Invalid billing request',
                details: error.issues
            }
        });
    }
    if (error instanceof BillingError) {
        return reply.code(error.statusCode).send({
            success: false,
            error: {
                code: error.code,
                message: error.message,
                details: error.details
            }
        });
    }
    reply.log.error({ err: error }, 'Unexpected billing error');
    return reply.code(500).send({
        success: false,
        error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred'
        }
    });
}
function getOrgId(request) {
    // Prefer org context attached by auth/middleware, then fall back to explicit
    // header context for clients that operate across multiple organizations.
    const orgIdFromUser = request.user?.orgId;
    const orgIdFromHeader = request.headers['x-org-id'];
    const orgId = orgIdFromUser ?? (typeof orgIdFromHeader === 'string' ? orgIdFromHeader : undefined);
    if (!orgId) {
        throw new BillingError(BillingErrorCodes.UNAUTHORIZED, 'Organization context is required', 401);
    }
    return orgId;
}
//# sourceMappingURL=routes.js.map
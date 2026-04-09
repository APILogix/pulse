// routes.ts - Billing Routes for Fastify

import type { FastifyInstance, FastifyPluginOptions, FastifyReply } from 'fastify';
import {
  BillingInterval,
  UsageMetricType,
  InvoiceStatus
} from './types.js';
import type {
  CreateSubscriptionBody,
  ChangePlanBody,
  CancelSubscriptionBody,
  AddPaymentMethodBody,
  PaymentMethod,
  UpdateBillingSettingsBody,
  ApplyCouponBody,
  QuotaIncreaseBody,
  UsageQueryParams,
  ListInvoicesQuery
} from './types.js';
import { BillingError, BillingErrorCodes } from './utils.js';
import { authenticate } from '../../shared/middleware/auth.js';

export async function billingRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
): Promise<void> {
  const service = fastify.billing.service;

  // ============================================
  // PLANS & PRICING
  // ============================================

  fastify.get('/plans', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const result = await service.listPlans();
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.get('/plans/:planId', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const { planId } = request.params as { planId: string };
      const result = await service.getPlan(planId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.get('/plans/compare', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const result = await service.comparePlans();
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/plans/estimate', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const { planId, interval, couponCode } = request.body as {
        planId: string;
        interval: BillingInterval;
        couponCode?: string;
      };
      const result = await service.estimatePricing(planId, interval, couponCode);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  // ============================================
  // SUBSCRIPTION MANAGEMENT
  // ============================================

  fastify.get('/subscription', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const result = await service.getSubscription(getOrgId(request));
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/subscription', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const body = request.body as CreateSubscriptionBody;
      const result = await service.createSubscription(getOrgId(request), body);
      return reply.code(201).send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.patch('/subscription/plan', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const body = request.body as ChangePlanBody;
      const result = await service.changePlan(getOrgId(request), body);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/subscription/cancel', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const body = request.body as CancelSubscriptionBody;
      const result = await service.cancelSubscription(getOrgId(request), body);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/subscription/reactivate', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const result = await service.reactivateSubscription(getOrgId(request));
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/subscription/preview-change', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const { newPlanId } = request.body as { newPlanId: string };
      const result = await service.previewProration(getOrgId(request), newPlanId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  // ============================================
  // PAYMENT METHODS
  // ============================================

  fastify.get('/payment-methods', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const result = await service.listPaymentMethods(getOrgId(request));
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/payment-methods', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const body = request.body as AddPaymentMethodBody;
      const result = await service.addPaymentMethod(getOrgId(request), body);
      return reply.code(201).send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.patch('/payment-methods/:id/default', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const result = await service.setDefaultPaymentMethod(getOrgId(request), id);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.patch('/payment-methods/:id', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const updates = request.body as Partial<PaymentMethod>;
      const result = await service.updatePaymentMethod(id, getOrgId(request), updates);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.delete('/payment-methods/:id', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const result = await service.removePaymentMethod(id, getOrgId(request));
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/payment-methods/:id/verify', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const result = await service.verifyPaymentMethod(id, getOrgId(request));
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  // ============================================
  // INVOICES
  // ============================================

  fastify.get('/invoices', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const query = request.query as ListInvoicesQuery;
      const options: {
        status?: InvoiceStatus;
        limit?: number;
        offset?: number;
        startDate?: Date;
        endDate?: Date;
      } = {};

      if (query.status) options.status = query.status as InvoiceStatus;
      if (query.limit !== undefined) options.limit = query.limit;
      if (query.page !== undefined) options.offset = (query.page - 1) * (query.limit || 10);
      if (query.startDate) options.startDate = new Date(query.startDate);
      if (query.endDate) options.endDate = new Date(query.endDate);

      const result = await service.listInvoices(getOrgId(request), options);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.get('/invoices/:id', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const result = await service.getInvoice(id, getOrgId(request));
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.get('/invoices/:id/pdf', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const result = await service.downloadInvoicePdf(id, getOrgId(request));
      if (result.data) {
        return reply.redirect(result.data);
      }
      return reply.code(404).send({ success: false, error: { message: 'PDF not available' } });
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/invoices/:id/pay', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const result = await service.payInvoice(id, getOrgId(request));
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.get('/invoices/upcoming', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const result = await service.getUpcomingInvoice(getOrgId(request));
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  // ============================================
  // USAGE & METERING
  // ============================================

  fastify.get('/usage', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const result = await service.getCurrentUsage(getOrgId(request));
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.get('/usage/detailed', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const query = request.query as UsageQueryParams;
      const result = await service.getDetailedUsage(getOrgId(request), query);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.get('/usage/history', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const { type } = request.query as { type: UsageMetricType };
      const result = await service.getUsageHistory(getOrgId(request), type);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.get('/usage/forecast', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const result = await service.getUsageForecast(getOrgId(request));
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.get('/usage/export', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const { format } = request.query as { format?: 'csv' | 'json' };
      const result = await service.exportUsageReport(getOrgId(request), format);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  // ============================================
  // QUOTAS
  // ============================================

  fastify.get('/quotas', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const result = await service.getQuotaStatus(getOrgId(request));
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.get('/quotas/:type', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const { type } = request.params as { type: UsageMetricType };
      const result = await service.getQuotaDetails(getOrgId(request), type);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/quotas/:type/increase', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const { type } = request.params as { type: UsageMetricType };
      const body = request.body as QuotaIncreaseBody;
      const result = await service.requestQuotaIncrease(getOrgId(request), type, body);
      return reply.code(201).send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.get('/quotas/requests', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const result = await service.listQuotaRequests(getOrgId(request));
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  // ============================================
  // BILLING SETTINGS
  // ============================================

  fastify.get('/settings', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const result = await service.getBillingSettings(getOrgId(request));
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.patch('/settings', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const body = request.body as UpdateBillingSettingsBody;
      const result = await service.updateBillingSettings(getOrgId(request), body);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.patch('/settings/email', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const { email } = request.body as { email: string };
      const result = await service.updateBillingEmail(getOrgId(request), email);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.patch('/settings/address', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const { address } = request.body as { address: any };
      const result = await service.updateBillingAddress(getOrgId(request), address);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.patch('/settings/tax', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const { taxId } = request.body as { taxId: string };
      const result = await service.updateTaxSettings(getOrgId(request), taxId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  // ============================================
  // COUPONS & PROMOTIONS
  // ============================================

  fastify.post('/coupons/apply', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const { code } = request.body as ApplyCouponBody;
      const result = await service.applyCoupon(getOrgId(request), code);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.delete('/coupons', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const result = await service.removeCoupon(getOrgId(request));
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/coupons/validate', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const { code } = request.body as ApplyCouponBody;
      const result = await service.validateCoupon(code);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.get('/promotions', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const result = await service.listPromotions();
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  // ============================================
  // WEBHOOKS
  // ============================================

  fastify.post('/webhooks/stripe', async (request, reply: FastifyReply) => {
    try {
      const payload = request.body as any;
      const signature = request.headers['stripe-signature'] as string;
      const result = await service.handleStripeWebhook(payload, signature);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/webhooks/:provider', async (request, reply: FastifyReply) => {
    try {
      const { provider } = request.params as { provider: string };
      const payload = request.body as any;
      const result = await service.handlePaymentWebhook(provider, payload);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  // ============================================
  // ADMIN OPERATIONS
  // ============================================

  fastify.post('/admin/sync', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const result = await service.forceSyncBilling(getOrgId(request));
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/admin/override', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const updates = request.body as any;
      const result = await service.adminOverrideSubscription(getOrgId(request), updates);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/admin/credits', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const { amount, reason } = request.body as { amount: number; reason: string };
      const result = await service.grantComplimentaryCredits(getOrgId(request), amount, reason);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/admin/invoices/:id/waive', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { reason } = request.body as { reason: string };
      const result = await service.waiveInvoice(id, getOrgId(request), reason);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.get('/admin/analytics', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const filters = request.query as any;
      const result = await service.getBillingAnalytics(filters);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  // ============================================
  // PORTAL & CHECKOUT
  // ============================================

  fastify.post('/portal/session', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const result = await service.createPortalSession(getOrgId(request));
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/checkout/session', {
    preHandler: [authenticate],
  }, async (request, reply: FastifyReply) => {
    try {
      const { planId } = request.body as { planId: string };
      const result = await service.createCheckoutSession(getOrgId(request), planId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });
}

// ============================================
// ERROR HANDLER
// ============================================

function handleBillingError(error: any, reply: FastifyReply) {
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
  
  console.error('Unexpected billing error:', error);
  return reply.code(500).send({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred'
    }
  });
}

function getOrgId(request: any): string {
  const orgIdFromUser = request.user?.orgId;
  const orgIdFromHeader = request.headers['x-org-id'];
  const orgId = orgIdFromUser ?? (typeof orgIdFromHeader === 'string' ? orgIdFromHeader : undefined);

  if (!orgId) {
    throw new BillingError(BillingErrorCodes.UNAUTHORIZED, 'Organization context is required', 401);
  }

  return orgId;
}

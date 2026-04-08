// routes.ts - Billing Routes for Fastify

import type { FastifyInstance, FastifyPluginOptions, FastifyReply } from 'fastify';
import { BillingService } from './billing.service.js';
import {
  RequestWithUser,
  CreateSubscriptionBody,
  ChangePlanBody,
  CancelSubscriptionBody,
  AddPaymentMethodBody,
  UpdateBillingSettingsBody,
  ApplyCouponBody,
  QuotaIncreaseBody,
  UsageQueryParams,
  ListInvoicesQuery,
  BillingInterval,
  UsageMetricType,
  InvoiceStatus
} from './types.js';
import { BillingError } from './utils.js';
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
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const result = await service.listPlans();
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.get('/plans/:planId', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
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
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const result = await service.comparePlans();
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/plans/estimate', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
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
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const result = await service.getSubscription(request.user.orgId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/subscription', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const body = request.body as CreateSubscriptionBody;
      const result = await service.createSubscription(request.user.orgId, body);
      return reply.code(201).send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.patch('/subscription/plan', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const body = request.body as ChangePlanBody;
      const result = await service.changePlan(request.user.orgId, body);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/subscription/cancel', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const body = request.body as CancelSubscriptionBody;
      const result = await service.cancelSubscription(request.user.orgId, body);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/subscription/reactivate', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const result = await service.reactivateSubscription(request.user.orgId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/subscription/preview-change', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const { newPlanId } = request.body as { newPlanId: string };
      const result = await service.previewProration(request.user.orgId, newPlanId);
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
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const result = await service.listPaymentMethods(request.user.orgId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/payment-methods', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const body = request.body as AddPaymentMethodBody;
      const result = await service.addPaymentMethod(request.user.orgId, body);
      return reply.code(201).send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.patch('/payment-methods/:id/default', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const result = await service.setDefaultPaymentMethod(request.user.orgId, id);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.patch('/payment-methods/:id', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const updates = request.body as Partial<AddPaymentMethodBody>;
      const result = await service.updatePaymentMethod(id, request.user.orgId, updates);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.delete('/payment-methods/:id', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const result = await service.removePaymentMethod(id, request.user.orgId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/payment-methods/:id/verify', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const result = await service.verifyPaymentMethod(id, request.user.orgId);
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
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const query = request.query as ListInvoicesQuery;
      const result = await service.listInvoices(request.user.orgId, {
        status: query.status as InvoiceStatus,
        limit: query.limit,
        offset: query.page ? (query.page - 1) * (query.limit || 10) : undefined,
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined
      });
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.get('/invoices/:id', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const result = await service.getInvoice(id, request.user.orgId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.get('/invoices/:id/pdf', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const result = await service.downloadInvoicePdf(id, request.user.orgId);
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
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const result = await service.payInvoice(id, request.user.orgId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.get('/invoices/upcoming', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const result = await service.getUpcomingInvoice(request.user.orgId);
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
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const result = await service.getCurrentUsage(request.user.orgId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.get('/usage/detailed', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const query = request.query as UsageQueryParams;
      const result = await service.getDetailedUsage(request.user.orgId, query);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.get('/usage/history', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const { type } = request.query as { type: UsageMetricType };
      const result = await service.getUsageHistory(request.user.orgId, type);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.get('/usage/forecast', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const result = await service.getUsageForecast(request.user.orgId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.get('/usage/export', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const { format } = request.query as { format?: 'csv' | 'json' };
      const result = await service.exportUsageReport(request.user.orgId, format);
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
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const result = await service.getQuotaStatus(request.user.orgId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.get('/quotas/:type', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const { type } = request.params as { type: UsageMetricType };
      const result = await service.getQuotaDetails(request.user.orgId, type);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/quotas/:type/increase', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const { type } = request.params as { type: UsageMetricType };
      const body = request.body as QuotaIncreaseBody;
      const result = await service.requestQuotaIncrease(request.user.orgId, type, body);
      return reply.code(201).send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.get('/quotas/requests', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const result = await service.listQuotaRequests(request.user.orgId);
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
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const result = await service.getBillingSettings(request.user.orgId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.patch('/settings', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const body = request.body as UpdateBillingSettingsBody;
      const result = await service.updateBillingSettings(request.user.orgId, body);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.patch('/settings/email', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const { email } = request.body as { email: string };
      const result = await service.updateBillingEmail(request.user.orgId, email);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.patch('/settings/address', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const { address } = request.body as { address: any };
      const result = await service.updateBillingAddress(request.user.orgId, address);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.patch('/settings/tax', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const { taxId } = request.body as { taxId: string };
      const result = await service.updateTaxSettings(request.user.orgId, taxId);
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
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const { code } = request.body as ApplyCouponBody;
      const result = await service.applyCoupon(request.user.orgId, code);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.delete('/coupons', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const result = await service.removeCoupon(request.user.orgId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/coupons/validate', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
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
  }, async (request: RequestWithUser, reply: FastifyReply) => {
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
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const result = await service.forceSyncBilling(request.user.orgId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/admin/override', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const updates = request.body as any;
      const result = await service.adminOverrideSubscription(request.user.orgId, updates);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/admin/credits', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const { amount, reason } = request.body as { amount: number; reason: string };
      const result = await service.grantComplimentaryCredits(request.user.orgId, amount, reason);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/admin/invoices/:id/waive', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { reason } = request.body as { reason: string };
      const result = await service.waiveInvoice(id, request.user.orgId, reason);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.get('/admin/analytics', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
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
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const result = await service.createPortalSession(request.user.orgId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  });

  fastify.post('/checkout/session', {
    preHandler: [authenticate],
  }, async (request: RequestWithUser, reply: FastifyReply) => {
    try {
      const { planId } = request.body as { planId: string };
      const result = await service.createCheckoutSession(request.user.orgId, planId);
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
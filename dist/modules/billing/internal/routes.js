import { timingSafeEqual } from 'crypto';
import { InternalBillingController } from './controller.js';
import { InternalBillingRepository } from './repository.js';
import { InternalBillingService } from './service.js';
function tokensMatch(actual, expected) {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
async function requireServiceToken(request, reply) {
    const expected = process.env.BILLING_INTERNAL_SERVICE_TOKEN ?? process.env.INTERNAL_SERVICE_TOKEN;
    const actual = request.headers['x-service-token'];
    const token = Array.isArray(actual) ? actual[0] : actual;
    if (!expected || !token || !tokensMatch(token, expected)) {
        return void reply.code(401).send({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'Invalid service token' },
            meta: { requestId: request.id, timestamp: new Date().toISOString() },
        });
    }
}
export async function internalBillingRoutes(fastify, _options) {
    const repository = new InternalBillingRepository();
    const service = new InternalBillingService(repository);
    const controller = new InternalBillingController(service);
    fastify.addHook('preHandler', requireServiceToken);
    fastify.get('/entitlements/:orgId', controller.getEntitlements);
    fastify.get('/entitlements/:orgId/features/:featureKey', controller.getFeature);
    fastify.get('/entitlements/:orgId/limits/:featureKey', controller.getLimit);
    fastify.post('/usage/events', controller.consumeEvents);
    fastify.post('/usage/events/bulk', controller.consumeEventsBulk);
    fastify.post('/usage/ai-credits', controller.consumeAiCredits);
    fastify.post('/usage/ai-credits/bulk', controller.consumeAiCreditsBulk);
    fastify.post('/usage/resources', controller.incrementResource);
    fastify.delete('/usage/resources', controller.decrementResource);
    fastify.get('/quotas/:orgId/events', controller.getEventQuota);
    fastify.get('/quotas/:orgId/ai-credits', controller.getAiCreditQuota);
    fastify.post('/quotas/:orgId/check', controller.checkQuota);
    fastify.post('/subscriptions/:orgId/sync', controller.syncSubscription);
    fastify.get('/subscriptions/:orgId/status', controller.getSubscriptionStatus);
    fastify.post('/invoices/generate', controller.generateInvoice);
    fastify.post('/invoices/finalize', controller.finalizeInvoice);
    fastify.post('/payments/reconcile', controller.reconcilePayments);
    fastify.post('/coupons/validate', controller.validateCoupon);
    fastify.post('/coupons/redeem', controller.redeemCoupon);
}
//# sourceMappingURL=routes.js.map
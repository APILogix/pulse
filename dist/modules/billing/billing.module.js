/**
 * Billing module for Fastify (Redesigned Vertical Slice Architecture).
 *
 * Flow:
 * 1. Register encapsulated slice routes (Plans, Subscriptions, Entitlements, Usage, etc.)
 * 2. Prefix them with /billing
 */
import fp from 'fastify-plugin';
import { plansRoutes } from './plans/routes.js';
import { subscriptionsRoutes } from './subscriptions/routes.js';
import { entitlementsRoutes } from './entitlements/routes.js';
import { usageRoutes } from './usage/routes.js';
import { invoicesRoutes } from './invoices/routes.js';
import { paymentsRoutes } from './payments/routes.js';
import { paymentMethodsRoutes } from './payment-methods/routes.js';
import { addonsRoutes } from './addons/routes.js';
import { webhooksRoutes } from './webhooks/routes.js';
import { couponsRoutes } from './coupons/routes.js';
import { internalBillingRoutes } from './internal/routes.js';
import { createBillingLogger } from './shared/utils.js';
const logger = createBillingLogger('Module');
async function billingModule(fastify, _options) {
    await fastify.register(plansRoutes, { prefix: '/billing/plans' });
    await fastify.register(subscriptionsRoutes, { prefix: '/billing/subscription' });
    await fastify.register(entitlementsRoutes, { prefix: '/billing/entitlements' });
    await fastify.register(usageRoutes, { prefix: '/billing/usage' });
    await fastify.register(invoicesRoutes, { prefix: '/billing/invoices' });
    await fastify.register(paymentsRoutes, { prefix: '/billing/payments' });
    await fastify.register(paymentMethodsRoutes, { prefix: '/billing/payment-methods' });
    await fastify.register(addonsRoutes, { prefix: '/billing/addons' });
    await fastify.register(couponsRoutes, { prefix: '/billing/coupons' });
    await fastify.register(webhooksRoutes, { prefix: '/billing/webhooks' });
    await fastify.register(internalBillingRoutes, { prefix: '/internal/v1' });
    fastify.addHook('onClose', async () => {
        logger.info('Billing module shutting down');
    });
}
export const registerBillingModule = fp(billingModule, { name: 'billing-module' });
export default registerBillingModule;
//# sourceMappingURL=billing.module.js.map
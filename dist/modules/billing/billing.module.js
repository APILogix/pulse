/**
 * Billing module for Fastify.
 *
 * Flow:
 * 1. Construct repository, service, and quota service once at boot.
 * 2. Decorate Fastify with billing dependencies for routes and other modules.
 * 3. Register billing routes under /billing.
 * 4. Attach shutdown logging for module lifecycle visibility.
 */
import fp from 'fastify-plugin';
import { BillingRepository } from './repository.js';
import { BillingService } from './billing.service.js';
import { QuotaService } from './quota-service.js';
import { billingRoutes } from './routes.js';
import { createBillingLogger } from './utils.js';
const logger = createBillingLogger('Module');
async function billingModule(fastify, _options) {
    // Keep billing dependencies singleton per Fastify app instance so route
    // handlers share the same repository/service objects.
    const repository = new BillingRepository();
    const service = new BillingService(repository);
    const quotaService = new QuotaService(repository);
    await repository.assertSchemaReady();
    await repository.seedDefaultPlans();
    logger.info('Billing schema verified and plans seeded');
    fastify.decorate('billing', {
        repository,
        service,
        quotaService
    });
    await fastify.register(billingRoutes, { prefix: '/billing' });
    fastify.addHook('onClose', async () => {
        logger.info('Billing module shutting down');
    });
}
export const registerBillingModule = fp(billingModule, { name: 'billing-module' });
export default registerBillingModule;
//# sourceMappingURL=billing.module.js.map
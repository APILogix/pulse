import { authenticate } from '../../../shared/middleware/auth.js';
import { ProviderSurfacesController } from './controller.js';
export async function providerSurfacesRoutes(fastify, _options) {
    const controller = new ProviderSurfacesController();
    fastify.addHook('preHandler', authenticate);
    fastify.post('/checkout/sessions', controller.createCheckoutSession);
    fastify.post('/customer-portal', controller.createCustomerPortal);
    fastify.post('/credit-notes', controller.createCreditNote);
    fastify.put('/tax-profile', controller.upsertTaxProfile);
}
//# sourceMappingURL=routes.js.map
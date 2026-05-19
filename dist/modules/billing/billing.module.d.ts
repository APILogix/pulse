/**
 * Billing module for Fastify.
 *
 * Flow:
 * 1. Construct repository, service, and quota service once at boot.
 * 2. Decorate Fastify with billing dependencies for routes and other modules.
 * 3. Register billing routes under /billing.
 * 4. Attach shutdown logging for module lifecycle visibility.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { BillingRepository } from './repository.js';
import { BillingService } from './billing.service.js';
import { QuotaService } from './quota-service.js';
declare module 'fastify' {
    interface FastifyInstance {
        billing: {
            repository: BillingRepository;
            service: BillingService;
            quotaService: QuotaService;
        };
    }
}
declare function billingModule(fastify: FastifyInstance, _options: FastifyPluginOptions): Promise<void>;
export declare const registerBillingModule: typeof billingModule;
export default registerBillingModule;
//# sourceMappingURL=billing.module.d.ts.map
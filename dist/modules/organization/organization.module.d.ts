/**
 * Organization module for Fastify.
 *
 * Flow:
 * 1. Construct repository and service dependencies at boot.
 * 2. Decorate Fastify with the organization service boundary.
 * 3. Register organization routes under /organizations.
 * 4. Log lifecycle events for startup and shutdown diagnostics.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { OrganizationRepository } from './repository.js';
import { OrganizationService } from './organizationservice.js';
import { SdkConfigService } from './sdk-config.service.js';
declare module 'fastify' {
    interface FastifyInstance {
        organization: {
            repository: OrganizationRepository;
            service: OrganizationService;
            sdkConfigService: SdkConfigService;
        };
    }
}
declare function organizationModule(fastify: FastifyInstance, _options: FastifyPluginOptions): Promise<void>;
export declare const registerOrganizationModule: typeof organizationModule;
export default registerOrganizationModule;
//# sourceMappingURL=organization.module.d.ts.map
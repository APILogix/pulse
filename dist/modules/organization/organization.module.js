/**
 * Organization module for Fastify.
 *
 * Flow:
 * 1. Construct repository and service dependencies at boot.
 * 2. Decorate Fastify with the organization service boundary.
 * 3. Register organization routes under /organizations.
 * 4. Log lifecycle events for startup and shutdown diagnostics.
 */
import fp from 'fastify-plugin';
import { OrganizationRepository } from './repository.js';
import { OrganizationService } from './organizationservice.js';
import { SdkConfigRepository } from './sdk-config.repository.js';
import { SdkConfigService } from './sdk-config.service.js';
import { organizationRoutes } from './routes.js';
import { createOrganizationLogger } from './utils.js';
const orgLogger = createOrganizationLogger('Module');
async function organizationModule(fastify, _options) {
    // Repository owns SQL; service owns membership, role, invitation, and audit
    // rules. Both are registered once per app instance.
    const repository = new OrganizationRepository();
    const service = new OrganizationService({
        repository,
        logger: fastify.log,
        emitEvent: async (event, payload) => {
            fastify.log.info({ event, payload }, 'Organization event emitted');
        }
    });
    // SDK Remote Config: its own repository, but reuses the organization
    // repository for membership/RBAC checks and audit-log writes.
    const sdkConfigRepository = new SdkConfigRepository();
    const sdkConfigService = new SdkConfigService(sdkConfigRepository, repository, fastify.log);
    fastify.decorate('organization', {
        repository,
        service,
        sdkConfigService
    });
    await fastify.register(organizationRoutes, { prefix: '/organizations' });
    fastify.addHook('onClose', async () => {
        orgLogger.info('Organization module shutting down');
    });
    orgLogger.info('Organization module registered');
}
export const registerOrganizationModule = fp(organizationModule, {
    name: 'organization-module'
});
export default registerOrganizationModule;
//# sourceMappingURL=organization.module.js.map
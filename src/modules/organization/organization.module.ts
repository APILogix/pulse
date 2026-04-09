// organization.module.ts - Organization Module for Fastify

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';
import { OrganizationRepository } from './repository.js';
import { OrganizationService } from './organizationservice.js';
import { organizationRoutes } from './routes.js';
import { createOrganizationLogger } from './utils.js';

declare module 'fastify' {
  interface FastifyInstance {
    organization: {
      repository: OrganizationRepository;
      service: OrganizationService;
    };
  }
}

const logger = createOrganizationLogger('Module');

async function organizationModule(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions
): Promise<void> {
  const repository = new OrganizationRepository();

  const service = new OrganizationService({
    repository,
    logger: fastify.log,
    emitEvent: async (event: string, payload: Record<string, unknown>) => {
      fastify.log.info({ event, payload }, 'Organization event emitted');
    }
  });

  // ✅ SAME PATTERN AS BILLING
  fastify.decorate('organization', {
    repository,
    service
  });

  try {
    logger.info('Organization module initialized');
  } catch (error) {
    logger.error('Failed to initialize organization module', error);
  }

  // ✅ SAME AS BILLING
  await fastify.register(organizationRoutes, { prefix: '/organizations' });

  fastify.addHook('onClose', async () => {
    logger.info('Organization module shutting down');
  });
}

export const registerOrganizationModule = fp(organizationModule, {
  name: 'organization-module'
});

export default registerOrganizationModule;
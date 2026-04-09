// billing.module.ts - Billing Module for Fastify

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';
import { BillingRepository } from './repository.js';
import { BillingService } from './billing.service.js';
import { QuotaService } from './quota-service.js';
import { billingRoutes } from './routes.js';
import { createBillingLogger } from './utils.js';

declare module 'fastify' {
  interface FastifyInstance {
    billing: {
      repository: BillingRepository;
      service: BillingService;
      quotaService: QuotaService;
    };
  }
}

const logger = createBillingLogger('Module');

async function billingModule(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions
): Promise<void> {
  const repository = new BillingRepository();
  const service = new BillingService(repository);
  const quotaService = new QuotaService(repository);

  fastify.decorate('billing', {
    repository,
    service,
    quotaService
  });

  try {
    await repository.seedDefaultPlans();
    logger.info('Billing module initialized and plans seeded');
  } catch (error) {
    logger.error('Failed to seed default plans', error);
  }

  await fastify.register(billingRoutes, { prefix: '/billing' });

  fastify.addHook('onClose', async () => {
    logger.info('Billing module shutting down');
  });
}

export const registerBillingModule = fp(billingModule, { name: 'billing-module' });
export default registerBillingModule;

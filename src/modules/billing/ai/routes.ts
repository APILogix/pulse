import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { AiBillingController } from './controller.js';
import { AiBillingService } from './service.js';
import { AiBillingRepository } from './repository.js';
import { authenticate } from '../../../shared/middleware/auth.js';

export async function aiBillingRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
): Promise<void> {
  const repository = new AiBillingRepository();
  const service = new AiBillingService(repository);
  const controller = new AiBillingController(service);

  // This route is typically called internally, but if called by the frontend or 
  // via a proxy, it needs authentication.
  fastify.addHook('preHandler', authenticate);

  fastify.post('/consume', controller.consumeAiCredits);
}

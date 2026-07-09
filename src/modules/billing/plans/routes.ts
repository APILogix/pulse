import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PlansController } from './controller.js';
import { PlansService } from './service.js';
import { PlansRepository } from './repository.js';
import { authenticate } from '../../../shared/middleware/auth.js';

export async function plansRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
): Promise<void> {
  const repository = new PlansRepository();
  const service = new PlansService(repository);
  const controller = new PlansController(service);

  fastify.get('/', { preHandler: [authenticate] }, controller.listPlans);
  fastify.get('/public', controller.listPublicPlans);
  fastify.get('/compare', { preHandler: [authenticate] }, controller.comparePlans);
  fastify.get('/:planId', { preHandler: [authenticate] }, controller.getPlan);
  fastify.post('/estimate', { preHandler: [authenticate] }, controller.estimatePricing);
}

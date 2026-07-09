import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { SubscriptionsController } from './controller.js';
import { SubscriptionsService } from './service.js';
import { SubscriptionsRepository } from './repository.js';
import { PlansRepository } from '../plans/repository.js';
import { authenticate } from '../../../shared/middleware/auth.js';

export async function subscriptionsRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
): Promise<void> {
  const repository = new SubscriptionsRepository();
  const plansRepository = new PlansRepository();
  const service = new SubscriptionsService(repository, plansRepository);
  const controller = new SubscriptionsController(service);

  // All subscription routes require authentication
  fastify.addHook('preHandler', authenticate);

  fastify.get('/', controller.getSubscription);
  fastify.get('/history', controller.getHistory);
  fastify.post('/', controller.createSubscription);
  fastify.post('/change-plan', controller.changePlan);
  fastify.post('/upgrade', controller.changePlan);
  fastify.post('/downgrade', controller.changePlan);
  fastify.post('/cancel', controller.cancelSubscription);
}

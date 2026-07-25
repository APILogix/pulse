import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { authenticate } from '../../../shared/middleware/auth.js';
import { AddonsController } from './controller.js';
import { AddonsRepository } from './repository.js';
import { AddonsService } from './service.js';

export async function addonsRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
): Promise<void> {
  const repository = new AddonsRepository();
  const service = new AddonsService(repository);
  const controller = new AddonsController(service);

  fastify.addHook('preHandler', authenticate);

  fastify.get('/', controller.listAddons);
  fastify.get('/subscription', controller.listSubscriptionAddons);
  fastify.post('/subscription', controller.subscribeAddon);
  fastify.delete('/subscription/:subscriptionAddonId', controller.cancelSubscriptionAddon);
}

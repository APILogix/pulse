import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { EntitlementsController } from './controller.js';
import { EntitlementsService } from './service.js';
import { EntitlementsRepository } from './repository.js';
import { authenticate } from '../../../shared/middleware/auth.js';

export async function entitlementsRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
): Promise<void> {
  const repository = new EntitlementsRepository();
  const service = new EntitlementsService(repository);
  const controller = new EntitlementsController(service);

  fastify.addHook('preHandler', authenticate);

  fastify.get('/', controller.getAllEntitlements);
  fastify.post('/check', controller.checkFeatureAccess);
}

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { UsageController } from './controller.js';
import { UsageService } from './service.js';
import { UsageRepository } from './repository.js';
import { authenticate } from '../../../shared/middleware/auth.js';

export async function usageRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
): Promise<void> {
  const repository = new UsageRepository();
  const service = new UsageService(repository);
  const controller = new UsageController(service);

  fastify.addHook('preHandler', authenticate);

  fastify.get('/current', controller.getCurrentUsage);
  fastify.get('/daily', controller.getDailyUsage);
  
  // This is a protected internal route that should ideally be called by an API gateway or internal service,
  // but for the sake of completeness it's exposed here behind auth.
  fastify.post('/increment-events', controller.incrementEventUsage);
}

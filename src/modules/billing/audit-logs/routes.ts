import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { authenticate } from '../../../shared/middleware/auth.js';
import { BillingAuditLogsController } from './controller.js';
import { BillingAuditLogsRepository } from './repository.js';
import { BillingAuditLogsService } from './service.js';

export async function billingAuditLogsRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
): Promise<void> {
  const repository = new BillingAuditLogsRepository();
  const service = new BillingAuditLogsService(repository);
  const controller = new BillingAuditLogsController(service);

  fastify.addHook('preHandler', authenticate);
  fastify.get('/', controller.listAuditLogs);
}

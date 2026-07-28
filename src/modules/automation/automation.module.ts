import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';
import { logger } from '../../config/logger.js';
import { pool } from '../../config/database.js';
import { AutomationRepository } from './repository.js';
import { AutomationService } from './service.js';
import { TemplateService } from './template.service.js';
import { AutomationAuditRepository } from './audit.js';
import { createActionRunner } from './action-runner.js';
import { automationRoutes } from './routes.js';
import { enqueueAutomationJob } from './workers.js';

const moduleLogger = logger.child({ component: 'automation-module' });

declare module 'fastify' {
  interface FastifyInstance {
    automation: {
      repository: AutomationRepository;
      service: AutomationService;
      templateService: TemplateService;
      auditRepository: AutomationAuditRepository;
    };
  }
}

async function automationModule(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
): Promise<void> {
  const repository = new AutomationRepository(pool);
  const auditRepository = new AutomationAuditRepository(pool);
  const actionRunner = createActionRunner();
  const service = new AutomationService(repository, auditRepository, actionRunner);
  const templateService = new TemplateService(repository, service);

  // Wire enqueue callback using pg-boss, preserving DB source of truth on send failure
  service.setEnqueueFn(async (job) => {
    try {
      await enqueueAutomationJob(job);
    } catch (err) {
      moduleLogger.warn({ err, jobType: job.type }, 'Failed to enqueue automation job (DB is source of truth)');
    }
  });

  fastify.decorate('automation', { repository, service, templateService, auditRepository });

  await fastify.register(automationRoutes, { prefix: '/organizations/:orgId/automation' });

  fastify.addHook('onClose', async () => {
    moduleLogger.info('Automation module shutting down');
  });

  moduleLogger.info('Automation module registered');
}

export const registerAutomationModule = fp(automationModule, { name: 'automation-module' });
export default registerAutomationModule;

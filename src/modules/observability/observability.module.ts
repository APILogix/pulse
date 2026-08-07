/**
 * Observability Explorer module.
 *
 * Wires the Unified Explorer Query Engine, correlation engine, AI investigator,
 * and context resolver into a single org-scoped router mounted at
 * `/organizations/:orgId/observability`. Telemetry reads hit the dedicated Log
 * DB; identity/permissions come from the primary DB. Redis-free.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';

import { pool } from '../../config/database.js';
import { logger } from '../../config/logger.js';
import { aiConfig } from '../../config/ai.js';
import { OpenAIProvider, type AIProvider } from '../ai/openai-client.js';

import { ObservabilityRepository } from './repository.js';
import { ObservabilityReleasesRepository } from './releases.repository.js';
import { ObservabilityContextResolver } from './context.js';
import { CorrelationEngine } from './correlation/engine.js';
import { AIInvestigator } from './ai/investigator.js';
import { ObservabilityService } from './service.js';
import { ObservabilityController } from './controller.js';
import { buildObservabilityRoutes } from './routes.js';

const moduleLogger = logger.child({ component: 'observability-module' });

declare module 'fastify' {
  interface FastifyInstance {
    observability: {
      service: ObservabilityService;
      controller: ObservabilityController;
    };
  }
}

async function observabilityModule(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
): Promise<void> {
  const repository = new ObservabilityRepository();
  const releases = new ObservabilityReleasesRepository(pool);
  const correlation = new CorrelationEngine(repository);

  // Only construct the AI provider when explicitly enabled; otherwise the
  // investigator degrades to deterministic heuristic analysis.
  const provider: AIProvider | null = aiConfig.enabled ? new OpenAIProvider(aiConfig, fastify.log) : null;
  const investigator = new AIInvestigator(provider, fastify.log);

  const service = new ObservabilityService(repository, correlation, investigator);
  const resolver = new ObservabilityContextResolver(pool);
  const controller = new ObservabilityController(service, resolver, releases);

  fastify.decorate('observability', { service, controller });

  await fastify.register(buildObservabilityRoutes(controller), {
    prefix: '/organizations/:orgId/observability',
  });

  fastify.addHook('onClose', async () => {
    moduleLogger.info('Observability explorer module shutting down');
  });

  moduleLogger.info(
    { resources: service.resourceNames(), aiEnabled: aiConfig.enabled },
    'Observability explorer module registered',
  );
}

export const registerObservabilityModule = fp(observabilityModule, { name: 'observability-module' });

export default registerObservabilityModule;

import fp from 'fastify-plugin';
import { pool } from '../../config/database.js';
import { logDB } from '../../config/log-database.js';
import { ErrorGroupRepository } from '../errors/repositories/error-group.repository.js';
import { ErrorGroupHistoryRepository } from '../errors/repositories/error-group-history.repository.js';
import { IssueLifecycleService } from '../errors/services/issue-lifecycle.service.js';
import { logger } from '../../config/logger.js';
import { aiConfig } from '../../config/ai.js';
import { OpenAIProvider } from '../ai/openai-client.js';
import { ObservabilityRepository } from './repository.js';
import { ObservabilityReleasesRepository } from './releases.repository.js';
import { ObservabilityContextResolver } from './context.js';
import { CorrelationEngine } from './correlation/engine.js';
import { AIInvestigator } from './ai/investigator.js';
import { ObservabilityService } from './service.js';
import { ObservabilityController } from './controller.js';
import { buildObservabilityRoutes } from './routes.js';
const moduleLogger = logger.child({ component: 'observability-module' });
async function observabilityModule(fastify, _options) {
    const repository = new ObservabilityRepository();
    const releases = new ObservabilityReleasesRepository(pool);
    const correlation = new CorrelationEngine(repository);
    // Only construct the AI provider when explicitly enabled; otherwise the
    // investigator degrades to deterministic heuristic analysis.
    const provider = aiConfig.enabled ? new OpenAIProvider(aiConfig, fastify.log) : null;
    const investigator = new AIInvestigator(provider, fastify.log);
    const lifecycle = new IssueLifecycleService(logDB.getPrimaryPool(), new ErrorGroupRepository(logDB.getPrimaryPool()), new ErrorGroupHistoryRepository(logDB.getPrimaryPool()));
    const service = new ObservabilityService(repository, correlation, investigator, lifecycle);
    const resolver = new ObservabilityContextResolver(pool);
    const controller = new ObservabilityController(service, resolver, releases);
    fastify.decorate('observability', { service, controller });
    await fastify.register(buildObservabilityRoutes(controller), {
        prefix: '/organizations/:orgId/observability',
    });
    fastify.addHook('onClose', async () => {
        moduleLogger.info('Observability explorer module shutting down');
    });
    moduleLogger.info({ resources: service.resourceNames(), aiEnabled: aiConfig.enabled }, 'Observability explorer module registered');
}
export const registerObservabilityModule = fp(observabilityModule, { name: 'observability-module' });
export default registerObservabilityModule;
//# sourceMappingURL=observability.module.js.map
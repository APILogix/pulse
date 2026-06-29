import fp from 'fastify-plugin';
import { pool } from '../../config/database.js';
import { logger } from '../../config/logger.js';
import { EventAnalyticsRepository } from './repository.js';
import { EventAnalyticsService } from './service.js';
import { eventAnalyticsRoutes } from './routes.js';
const moduleLogger = logger.child({ component: 'event-analytics-module' });
async function eventAnalyticsModule(fastify, _options) {
    const repository = new EventAnalyticsRepository(pool);
    const service = new EventAnalyticsService(repository, fastify.log);
    fastify.decorate('eventAnalytics', { repository, service });
    await fastify.register(eventAnalyticsRoutes, { prefix: '/organizations/:orgId/analytics' });
    fastify.addHook('onClose', async () => {
        moduleLogger.info('Event-analytics module shutting down');
    });
    moduleLogger.info('Event-analytics module registered');
}
export const registerEventAnalyticsModule = fp(eventAnalyticsModule, { name: 'event-analytics-module' });
export default registerEventAnalyticsModule;
//# sourceMappingURL=event-analytics.module.js.map
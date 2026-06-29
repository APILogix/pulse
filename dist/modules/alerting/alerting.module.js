import fp from 'fastify-plugin';
import { logger } from '../../config/logger.js';
import { AlertingRepository } from './repository.js';
import { AlertingService } from './service.js';
import { alertingRoutes } from './routes.js';
const moduleLogger = logger.child({ component: 'alerting-module' });
async function alertingModule(fastify, _options) {
    const repository = new AlertingRepository();
    const service = new AlertingService({ repository, logger: fastify.log });
    fastify.decorate('alerting', { repository, service });
    await fastify.register(alertingRoutes, { prefix: '/organizations/:orgId/alerting' });
    fastify.addHook('onClose', async () => {
        moduleLogger.info('Alerting module shutting down');
    });
    moduleLogger.info('Alerting module registered');
}
export const registerAlertingModule = fp(alertingModule, { name: 'alerting-module' });
export default registerAlertingModule;
//# sourceMappingURL=alerting.module.js.map
import fp from 'fastify-plugin';
import { logger } from '../../config/logger.js';
import { AlertingRepository } from './repository.js';
import { AlertingService } from './service.js';
import { alertingRoutes } from './routes.js';
import { alertingWorkspaceRoutes } from './workspace/alerting-workspace.routes.js';
import { pool } from '../../config/database.js';
import { logDB } from '../../config/log-database.js';
import { ProjectAlertQueryService } from './runtime/project-alert-query.service.js';
import { projectAlertQueryRoutes } from './runtime/project-alert-query.routes.js';
const moduleLogger = logger.child({ component: 'alerting-module' });
async function alertingModule(fastify, _options) {
    const repository = new AlertingRepository();
    const service = new AlertingService({ repository, logger: fastify.log });
    const projectAlerts = new ProjectAlertQueryService(logDB.getPrimaryPool(), pool);
    fastify.decorate('alerting', { repository, service, projectAlerts });
    await fastify.register(alertingWorkspaceRoutes, { prefix: '/organizations/:orgId' });
    await fastify.register(alertingRoutes, { prefix: '/organizations/:orgId/alerting' });
    await fastify.register(projectAlertQueryRoutes, { prefix: '/organizations/:orgId' });
    fastify.addHook('onClose', async () => {
        moduleLogger.info('Alerting module shutting down');
    });
    moduleLogger.info('Alerting module registered');
}
export const registerAlertingModule = fp(alertingModule, { name: 'alerting-module' });
export default registerAlertingModule;
//# sourceMappingURL=alerting.module.js.map
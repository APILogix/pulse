import fp from 'fastify-plugin';
import { logger } from '../../config/logger.js';
import { pgmq } from '../../lib/pgmq.js';
import { ConnectorRepository } from './repository.js';
import { NotificationDispatcher } from './delivery/delivery.service.js';
import { ConnectorService } from './service.js';
import { ConnectorMonitor } from './monitor.js';
import { connectorRoutes } from './routes.js';
import { slackConnectorRoutes } from './providers/slack/slack.routes.js';
import { CONNECTOR_JOBS, CONNECTOR_TRANSPORT_QUEUE_PREFIX } from './job.constants.js';
import { env } from '../../config/env.js';
import './registry.js'; // ensure built-in connector types register at boot
const moduleLogger = logger.child({ component: 'connectors-module' });
async function connectorsPlugin(fastify, _options) {
    const repository = new ConnectorRepository();
    const dispatcher = new NotificationDispatcher(repository, fastify.log);
    const service = new ConnectorService({
        repository,
        dispatcher,
        logger: fastify.log,
        enqueueConnectorJob: async (queue, data, options) => {
            const delaySeconds = typeof options?.delaySeconds === 'number' ? options.delaySeconds : undefined;
            return pgmq.send(queue, data, delaySeconds !== undefined ? { delaySeconds } : undefined);
        },
    });
    const monitor = new ConnectorMonitor(repository, dispatcher, service, fastify.log);
    fastify.decorate('connectors', { repository, dispatcher, service, monitor });
    await fastify.register(connectorRoutes, { prefix: '/organizations/:orgId/connectors' });
    await fastify.register(slackConnectorRoutes);
    fastify.addHook('onClose', async () => {
        monitor.stop();
    });
    moduleLogger.info('Connectors module initialized with Supabase PGMQ');
}
export const registerConnectorsModule = fp(connectorsPlugin, {
    name: 'connectors-module',
});
export default registerConnectorsModule;
//# sourceMappingURL=connectors.module.js.map
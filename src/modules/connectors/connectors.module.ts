/**
 * Notification connectors module for Fastify.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';
import { logger } from '../../config/logger.js';
import { pgmq } from '../../lib/pgmq.js';
import { ConnectorRepository } from './repository.js';
import { NotificationDispatcher } from './delivery/delivery.service.js';
import { ConnectorService } from './service.js';
import { ConnectorMonitor } from './monitor.js';
import { connectorRoutes } from './routes.js';
import { slackConnectorRoutes } from './providers/slack/slack.routes.js';
import { CONNECTOR_JOBS, CONNECTOR_TRANSPORT_QUEUE_PREFIX, type ConnectorJobName } from './job.constants.js';
import { env } from '../../config/env.js';
import './registry.js'; // ensure built-in connector types register at boot

const moduleLogger = logger.child({ component: 'connectors-module' });

declare module 'fastify' {
  interface FastifyInstance {
    connectors: {
      repository: ConnectorRepository;
      dispatcher: NotificationDispatcher;
      service: ConnectorService;
      monitor: ConnectorMonitor;
    };
  }
}

async function connectorsPlugin(fastify: FastifyInstance, _options: FastifyPluginOptions): Promise<void> {
  const repository = new ConnectorRepository();
  const dispatcher = new NotificationDispatcher(repository, fastify.log);
  const service = new ConnectorService({
    repository,
    dispatcher,
    logger: fastify.log,
    enqueueConnectorJob: async (queue: ConnectorJobName, data: Record<string, unknown>, options?: Record<string, unknown>) => {
      const delaySeconds = typeof options?.delaySeconds === 'number' ? options.delaySeconds : undefined;
      return pgmq.send(
        queue,
        data,
        delaySeconds !== undefined ? { delaySeconds } : undefined,
      );
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

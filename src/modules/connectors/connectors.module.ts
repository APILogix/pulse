/**
 * Notification connectors module for Fastify.
 *
 * Flow:
 * 1. Construct repository, dispatcher, service, and the background monitor.
 * 2. Decorate Fastify with the connector service boundary.
 * 3. Register connector routes under /organizations/:orgId/connectors.
 *
 * The background monitor (retry + health sweeps) is NOT started here — it runs
 * only in the worker process (npm run dev:workers) via startConnectorMonitor()
 * in workers/main.ts. The API process (npm run dev) serves HTTP only and runs
 * no background job workers.
 *
 * The connector type registry self-registers built-in connectors on import.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';
import { logger } from '../../config/logger.js';
import { ConnectorRepository } from './repository.js';
import { NotificationDispatcher } from './dispatcher.js';
import { ConnectorService } from './service.js';
import { ConnectorMonitor } from './monitor.js';
import { connectorRoutes } from './routes.js';
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

async function connectorsModule(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
): Promise<void> {
  const repository = new ConnectorRepository();
  const dispatcher = new NotificationDispatcher(repository, fastify.log);
  const service = new ConnectorService({
    repository,
    dispatcher,
    logger: fastify.log,
    emitEvent: async (event, payload) => {
      fastify.log.info({ event, payload }, 'Connector event emitted');
    },
  });
  const monitor = new ConnectorMonitor(repository, dispatcher, service, fastify.log);

  fastify.decorate('connectors', { repository, dispatcher, service, monitor });

  await fastify.register(connectorRoutes, { prefix: '/organizations/:orgId/connectors' });

  // NOTE: monitor.start() is intentionally NOT called here. Background sweeps
  // run only in the worker process (workers/main.ts → startConnectorMonitor).
  fastify.addHook('onClose', async () => {
    monitor.stop(); // no-op in the API process (never started here)
    moduleLogger.info('Connectors module shutting down');
  });

  moduleLogger.info('Connectors module registered');
}

export const registerConnectorsModule = fp(connectorsModule, {
  name: 'connectors-module',
});

export default registerConnectorsModule;

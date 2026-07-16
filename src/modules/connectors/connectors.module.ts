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
import { pgboss } from '../../lib/pgboss.js';
import { ConnectorRepository } from './repository.js';
import { NotificationDispatcher } from './delivery/delivery.service.js';
import { ConnectorService } from './service.js';
import { ConnectorMonitor } from './monitor.js';
import { connectorRoutes } from './routes.js';
import { slackConnectorRoutes } from './providers/slack/slack.routes.js';
import { CONNECTOR_JOBS } from './job.constants.js';
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
    enqueueConnectorJob: async (queue, data, options) => {
      const boss = pgboss as unknown as { createQueue?: (n: string) => Promise<void> };
      if (typeof boss.createQueue === 'function') {
        await boss.createQueue(queue).catch(() => undefined);
      }

      let expireInSeconds = 60; // fallback
      if (queue.startsWith(CONNECTOR_JOBS.send)) {
        expireInSeconds = env.CONNECTOR_SEND_EXPIRE_SECONDS;
      } else if (queue === CONNECTOR_JOBS.healthCheck) {
        expireInSeconds = env.CONNECTOR_HEALTH_EXPIRE_SECONDS;
      } else if (queue === CONNECTOR_JOBS.cleanup) {
        expireInSeconds = env.CONNECTOR_CLEANUP_EXPIRE_SECONDS;
      } else if (queue === CONNECTOR_JOBS.secretRotation || queue === CONNECTOR_JOBS.oauthRefresh) {
        expireInSeconds = env.CONNECTOR_SECRET_EXPIRE_SECONDS;
      } else if (queue === CONNECTOR_JOBS.deliveryRetry || queue === CONNECTOR_JOBS.deadLetterRetry) {
        expireInSeconds = env.CONNECTOR_RETRY_EXPIRE_SECONDS;
      }

      const mergedOptions = { expireInSeconds, ...options };
      return pgboss.send(queue, data, mergedOptions as never);
    },
  });
  const monitor = new ConnectorMonitor(repository, dispatcher, service, fastify.log);

  fastify.decorate('connectors', { repository, dispatcher, service, monitor });

  await fastify.register(connectorRoutes, { prefix: '/organizations/:orgId/connectors' });
  await fastify.register(slackConnectorRoutes);

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

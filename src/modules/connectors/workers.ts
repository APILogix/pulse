/**
 * Connector background worker entry.
 *
 * Constructs the connector repository/dispatcher/service and starts the
 * ConnectorMonitor (delivery retry sweeps + health heartbeats). This runs ONLY
 * in the worker process (npm run dev:workers); the API process never starts it.
 */
import type { FastifyBaseLogger } from 'fastify';
import { ConnectorRepository } from './repository.js';
import { NotificationDispatcher } from './delivery/delivery.service.js';
import { ConnectorService } from './service.js';
import { ConnectorMonitor } from './monitor.js';
import './registry.js'; // ensure built-in connector types register

export function startConnectorMonitor(logger: FastifyBaseLogger): { stop: () => Promise<void> } {
  const log = logger.child({ component: 'connector-monitor-worker' });
  const repository = new ConnectorRepository();
  const dispatcher = new NotificationDispatcher(repository, logger);
  const service = new ConnectorService({
    repository,
    dispatcher,
    logger,
    emitEvent: async () => undefined,
  });
  const monitor = new ConnectorMonitor(repository, dispatcher, service, logger);
  monitor.start();
  log.info('Connector monitor started');

  return {
    stop: async () => {
      monitor.stop();
    },
  };
}

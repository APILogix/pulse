/**
 * Connector background worker entry.
 *
 * Registers connector pg-boss workers. This runs ONLY in the worker process
 * (npm run dev:workers); the API process never starts background delivery.
 */
import type { FastifyBaseLogger } from 'fastify';
import './registry.js'; // ensure built-in connector types register
import { registerConnectorWorkers, type ConnectorWorkerConfig } from './queue.js';

export type { ConnectorWorkerConfig } from './queue.js';

export async function startConnectorMonitor(
  logger: FastifyBaseLogger,
  config: ConnectorWorkerConfig = {},
): Promise<{ stop: () => Promise<void> }> {
  return registerConnectorWorkers(logger, undefined, config);
}

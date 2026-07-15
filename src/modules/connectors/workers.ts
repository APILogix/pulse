/**
 * Connector background worker entry.
 *
 * Registers connector pg-boss workers. This runs ONLY in the worker process
 * (npm run dev:workers); the API process never starts background delivery.
 */
import type { FastifyBaseLogger } from 'fastify';
import './registry.js'; // ensure built-in connector types register
import { registerConnectorWorkers } from './queue.js';

export async function startConnectorMonitor(logger: FastifyBaseLogger): Promise<{ stop: () => Promise<void> }> {
  return registerConnectorWorkers(logger);
}

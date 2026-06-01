/**
 * Ingestion module for Fastify (PostgreSQL-queue cutover — no BullMQ/Redis).
 *
 * Flow:
 * 1. Reuse the shared Postgres pool from config/database.ts.
 * 2. Create the PostgresWriter (project auth + read endpoints).
 * 3. Decorate Fastify so routes can construct the IngestionService, which now
 *    enqueues into the Postgres-native queue (PgQueue) instead of BullMQ.
 * 4. Register ingestion routes under /api.
 *
 * The queue is durable in Postgres. There is no in-memory buffer and no Redis
 * queue. Persistence happens asynchronously in the PgQueueWorker (worker
 * process), not in this module.
 */
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { pool } from '../../config/database.js';
import { logger } from '../../config/logger.js';
import { ingestionRoutes } from './routes.js';
import { PostgresWriter } from './postgress.writter.js';

const ingestionLogger = logger.child({ component: 'ingestion-module' });

declare module 'fastify' {
  interface FastifyInstance {
    postgresWriter: PostgresWriter;
  }
}

export const ingestionModule = fp(
  async function ingestionPlugin(fastify: FastifyInstance) {
    const postgresWriter = new PostgresWriter(pool);
    fastify.decorate('postgresWriter', postgresWriter);

    await fastify.register(ingestionRoutes, { prefix: '/api' });

    ingestionLogger.info('Ingestion module registered (pg-queue)');
  },
  {
    name: 'ingestion-module',
  },
);

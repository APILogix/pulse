/**
 * Ingestion module for Fastify (pg-boss enterprise pipeline).
 *
 * Flow:
 * 1. Reuse the shared Postgres pool from config/database.ts.
 * 2. Create the PostgresWriter (project auth + read endpoints).
 * 3. Decorate Fastify so routes can construct the IngestionService, which
 *    validates and enqueues per-type jobs into pg-boss (ingest.<type> queues).
 * 4. Register ingestion routes under /api.
 *
 * Durability comes from the pg-boss job rows in Postgres. Persistence into
 * the typed events_* tables happens asynchronously in the dedicated ingestion
 * worker process (per-type workers), never in this module.
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

    ingestionLogger.info('Ingestion module registered (pg-boss gateway)');
  },
  {
    name: 'ingestion-module',
  },
);

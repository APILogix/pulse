/**
 * Ingestion route registration.
 *
 * Flow:
 * 1. Read infrastructure dependencies that were attached to the Fastify instance
 *    during application boot: BullMQ ingestion queue, Redis cache, and Postgres writer.
 * 2. Construct the service once for this route scope so every handler shares the
 *    same buffer, queue, cache, and persistence objects.
 * 3. Bind controller methods explicitly because Fastify calls handlers without the
 *    class instance context.
 * 4. Attach shutdown cleanup so buffered ingestion events are flushed before the
 *    Fastify process closes.
 */
import type { FastifyInstance } from "fastify";
export declare function ingestionRoutes(fastify: FastifyInstance): Promise<void>;
//# sourceMappingURL=routes.d.ts.map
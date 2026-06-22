/**
 * Ingestion route registration.
 *
 * Flow:
 * 1. Read infrastructure dependencies that were attached to the Fastify instance
 *    during application boot: shared Postgres pool and writer.
 * 2. Construct the service once for this route scope so every handler shares the
 *    same buffer, queue, cache, and persistence objects.
 * 3. Bind controller methods explicitly because Fastify calls handlers without
 *    the class instance context.
 * 4. Attach shutdown cleanup so process-local state (rate buckets) is released
 *    before the Fastify process closes.
 *
 * Hardening choices:
 *   - All ingestion endpoints carry strict JSON-Schema validation so malformed
 *     bodies are rejected at the framework boundary, before any handler logic.
 *   - The /v1/limits endpoint uses the Authorization header as the API-key
 *     channel (NOT a query string) to avoid leaking the secret into access
 *     logs, browser history, and CDN/proxy logs.
 *   - Routes that operate on dead-lettered jobs require platform-admin so a
 *     compromised user account cannot retrigger every failed job in the system.
 */
import type { FastifyInstance } from "fastify";
export declare function ingestionRoutes(fastify: FastifyInstance): Promise<void>;
//# sourceMappingURL=routes.d.ts.map
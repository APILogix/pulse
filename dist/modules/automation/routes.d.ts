/**
 * Automation Routes – registers all public org automation API endpoints.
 * Every route uses authenticate + requireOrgAccess.
 * Event ingestion has route-level rate limit and 256KB body validation.
 */
import type { FastifyInstance } from 'fastify';
export declare function automationRoutes(fastify: FastifyInstance): Promise<void>;
//# sourceMappingURL=routes.d.ts.map
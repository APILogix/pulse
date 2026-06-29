/**
 * Event-analytics routes.
 *
 * Organization-scoped under /organizations/:orgId/analytics. Every route runs
 * `authenticate` + `requireOrgAccess`. No caching, no rate limiting (per
 * requirements). SSE "live" endpoints stream via a bounded DB poll loop (no
 * Redis pub/sub dependency) and clean up on client disconnect.
 */
import type { FastifyInstance } from 'fastify';
export declare function eventAnalyticsRoutes(fastify: FastifyInstance): Promise<void>;
//# sourceMappingURL=routes.d.ts.map
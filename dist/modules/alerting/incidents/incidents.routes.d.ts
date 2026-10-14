/**
 * Incident route registration.
 *
 * All routes are organization-scoped and require `authenticate` +
 * `requireOrgAccess`. Handlers validate input with Zod, delegate to the service,
 * and map domain errors via `withErrorHandling`. Controllers stay thin: no
 * business logic, no SQL.
 *
 * Mounted under /organizations/:orgId/alerting (see alerting.module.ts), so the
 * effective paths are e.g. GET /organizations/:orgId/alerting/incidents.
 */
import type { FastifyInstance } from 'fastify';
export declare function incidentsRoutes(fastify: FastifyInstance): Promise<void>;
//# sourceMappingURL=incidents.routes.d.ts.map
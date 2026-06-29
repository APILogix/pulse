/**
 * Connector route registration.
 *
 * All routes are organization-scoped and require:
 *   - `authenticate` (valid session)
 *   - `requireOrgAccess` (active membership of :orgId)
 *
 * Handlers parse params/query/body with Zod, delegate to the service, and use
 * `withErrorHandling` to map AppError subclasses to HTTP responses.
 */
import type { FastifyInstance } from 'fastify';
export declare function connectorRoutes(fastify: FastifyInstance): Promise<void>;
//# sourceMappingURL=routes.d.ts.map
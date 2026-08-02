/**
 * Alerting route registration.
 *
 * All routes are organization-scoped and require `authenticate` +
 * `requireOrgAccess`. Handlers validate input with Zod, delegate to the
 * service, and map domain errors via `withErrorHandling`.
 *
 * Mounted under /organizations/:orgId/alerting (matches the codebase's
 * org-scoped module convention; see note in docs).
 */
import type { FastifyInstance } from 'fastify';
export declare function silencesRoutes(fastify: FastifyInstance): Promise<void>;
//# sourceMappingURL=silences.routes.d.ts.map
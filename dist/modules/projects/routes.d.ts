/**
 * Project route registration.
 *
 * Flow:
 * 1. Authenticate the caller for every project and API-key management endpoint.
 * 2. Parse params, query, and body with module schemas before calling service
 *    methods.
 * 3. Pass request metadata into mutating service calls so audit logging can
 *    record request id, IP address, and user agent.
 * 4. Normalize service errors through handleProjectError.
 */
import type { FastifyInstance } from "fastify";
export declare function projectsRoutes(fastify: FastifyInstance): Promise<void>;
//# sourceMappingURL=routes.d.ts.map
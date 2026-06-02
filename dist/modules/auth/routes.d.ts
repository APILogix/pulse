/**
 * Auth Routes — Fastify HTTP layer.
 *
 * Responsibilities:
 *   - Validate request payloads with Zod schemas in types.ts.
 *   - Pull client metadata via getClientInfo (trust-proxy aware, no XFF
 *     spoofing — see shared/utils/request.ts).
 *   - Delegate all business decisions to service.ts.
 *   - Map AuthError -> HTTP responses without leaking internals.
 *
 * Refresh-token transport:
 *   - The refresh JWT lives in an httpOnly, signed, SameSite=Strict cookie
 *     named `__Host-refresh_token` with Path=/. This forces the browser to
 *     require Secure + no Domain attribute, blocking sibling-subdomain
 *     overwrite attacks.
 *
 * Rate limiting:
 *   - Scoped in-process LRU limits (rate-limits.ts) on sensitive auth routes.
 *   - Global Fastify rate limiter (app.ts) still applies as a backstop.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
export declare function handleAuthError(error: unknown, reply: FastifyReply, request: FastifyRequest): FastifyReply;
export default function authRoutes(fastify: FastifyInstance): Promise<void>;
//# sourceMappingURL=routes.d.ts.map
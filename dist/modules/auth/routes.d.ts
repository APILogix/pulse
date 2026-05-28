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
 *   - Per-route rate limiting has been removed at the team's direction. The
 *     global Fastify rate limiter (configured in app.ts) still applies. If
 *     you reintroduce per-route limits, do it via a preHandler shared with
 *     the rest of the platform.
 */
import type { FastifyInstance } from 'fastify';
export default function authRoutes(fastify: FastifyInstance): Promise<void>;
//# sourceMappingURL=routes.d.ts.map
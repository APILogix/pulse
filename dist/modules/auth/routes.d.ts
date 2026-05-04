/**
 * Auth Routes - Fastify route handlers
 * Enterprise security headers, rate limiting, validation
 *
 * Flow:
 * 1. Route handlers validate request payloads with auth schemas.
 * 2. Request metadata is extracted for security checks, session fingerprinting,
 *    and audit logging.
 * 3. Business decisions are delegated to service.ts.
 * 4. Access tokens are returned in the response body, while refresh tokens are
 *    stored as httpOnly cookies to reduce client-side exposure.
 */
import type { FastifyInstance } from 'fastify';
export default function authRoutes(fastify: FastifyInstance): Promise<void>;
//# sourceMappingURL=routes.d.ts.map
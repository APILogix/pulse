/**
 * Auth Module - Registration and initialization
 *
 * Flow:
 * 1. Register all auth routes under /auth.
 * 2. Leave auth dependency construction to imported route/service modules.
 * 3. Log module registration for boot diagnostics.
 */
import type { FastifyInstance } from 'fastify';
export declare function registerAuthModule(fastify: FastifyInstance): Promise<void>;
//# sourceMappingURL=auth.module.d.ts.map
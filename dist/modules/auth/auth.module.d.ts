/**
 * Auth Module — Registration and initialization.
 *
 * Wrapped in fastify-plugin so auth decorators (if added later) are visible
 * across the entire Fastify instance, not encapsulated within this plugin scope.
 *
 * Flow:
 * 1. Register all auth routes under /auth.
 * 2. Leave auth dependency construction to imported route/service modules.
 */
import type { FastifyInstance } from 'fastify';
declare function authModule(fastify: FastifyInstance): Promise<void>;
export declare const registerAuthModule: typeof authModule;
export default registerAuthModule;
//# sourceMappingURL=auth.module.d.ts.map
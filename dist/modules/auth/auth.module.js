/**
 * Auth Module - Registration and initialization
 *
 * Flow:
 * 1. Register all auth routes under /auth.
 * 2. Leave auth dependency construction to imported route/service modules.
 * 3. Log module registration for boot diagnostics.
 */
import authRoutes from './routes.js';
export async function registerAuthModule(fastify) {
    // Register routes with prefix so route definitions can stay relative inside
    // auth/routes.ts.
    await fastify.register(authRoutes, { prefix: '/auth' });
    fastify.log.info('Auth module registered');
}
//# sourceMappingURL=auth.module.js.map
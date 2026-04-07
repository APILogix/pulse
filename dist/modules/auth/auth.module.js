/**
 * Auth Module - Registration and initialization
 */
import authRoutes from './routes.js';
export async function registerAuthModule(fastify) {
    // Register routes with prefix
    await fastify.register(authRoutes, { prefix: '/auth' });
    fastify.log.info('Auth module registered');
}
//# sourceMappingURL=auth.module.js.map
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
import fp from 'fastify-plugin';
import authRoutes from './routes.js';
import { logger } from '../../config/logger.js';
const authLogger = logger.child({ component: 'auth-module' });
async function authModule(fastify) {
    await fastify.register(authRoutes, { prefix: '/auth' });
    fastify.addHook('onClose', async () => {
        authLogger.info('Auth module shutting down');
    });
    authLogger.info('Auth module registered');
}
export const registerAuthModule = fp(authModule, { name: 'auth-module' });
export default registerAuthModule;
//# sourceMappingURL=auth.module.js.map
import fp from 'fastify-plugin';
import authRoutes from './routes.js';
import { registerScimRoutes } from '../scim/scim.routes.js';
import { logger } from '../../config/logger.js';
const authLogger = logger.child({ component: 'auth-module' });
async function authModule(fastify) {
    // Initialize request.user to null so a misconfigured handler that reads
    // it before `authenticate` runs returns null (then crashes with a clear
    // message) rather than throwing an opaque "Cannot read properties of
    // undefined" deep in the codebase.
    if (!fastify.hasRequestDecorator('user')) {
        fastify.decorateRequest('user', null);
    }
    await fastify.register(authRoutes, { prefix: '/auth' });
    await fastify.register(registerScimRoutes, { prefix: '/scim/v2' });
    fastify.addHook('onClose', async () => {
        authLogger.info('Auth module shutting down');
    });
    authLogger.info('Auth module registered');
}
export const registerAuthModule = fp(authModule, { name: 'auth-module' });
export default registerAuthModule;
//# sourceMappingURL=auth.module.js.map
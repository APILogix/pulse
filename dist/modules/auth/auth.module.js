import fp from 'fastify-plugin';
import authRoutes from './routes.js';
import { registerScimRoutes } from '../scim/scim.routes.js';
import { logger } from '../../config/logger.js';
import { registerPassportSocialAuth } from './passport-social.service.js';
const authLogger = logger.child({ component: 'auth-module' });
async function authModule(fastify) {
    await registerPassportSocialAuth(fastify);
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
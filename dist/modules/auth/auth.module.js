import fp from 'fastify-plugin';
import authRoutes from './presentation/routes/index.js';
import { registerScimRoutes } from '../scim/scim.routes.js';
import { logger } from '../../config/logger.js';
import { registerPassportSocialAuth } from './application/services/passport-social.service.js';
const authLogger = logger.child({ component: 'auth-module' });
async function authModule(fastify) {
    // Passport must be initialized in the same Fastify scope before any route
    // invokes socialPassport.authenticate(). Without this registration,
    // @fastify/passport throws "passport.initialize() plugin not in use" at
    // runtime when the OAuth authorize/callback routes are requested.
    await registerPassportSocialAuth(fastify);
    await fastify.register(authRoutes, { prefix: '/auth' });
    await fastify.register(authRoutes, { prefix: '/api/v1/auth' });
    await fastify.register(registerScimRoutes, { prefix: '/scim/v2' });
    fastify.addHook('onClose', async () => {
        authLogger.info('Auth module shutting down');
    });
    authLogger.info('Auth module registered');
}
export const registerAuthModule = fp(authModule, { name: 'auth-module' });
export default registerAuthModule;
//# sourceMappingURL=auth.module.js.map
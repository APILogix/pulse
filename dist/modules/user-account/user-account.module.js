import fp from 'fastify-plugin';
import { userAccountRoutes } from './routes.js';
async function userAccountModule(fastify) {
    await fastify.register(userAccountRoutes, { prefix: '/user' });
}
export const registerUserAccountModule = fp(userAccountModule, {
    name: 'user-account-module',
});
export default registerUserAccountModule;
//# sourceMappingURL=user-account.module.js.map
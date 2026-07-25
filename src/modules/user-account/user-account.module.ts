import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { userAccountRoutes } from './routes.js';

async function userAccountModule(fastify: FastifyInstance): Promise<void> {
  await fastify.register(userAccountRoutes, { prefix: '/user' });
}

export const registerUserAccountModule = fp(userAccountModule, {
  name: 'user-account-module',
});

export default registerUserAccountModule;

/**
 * Auth Module — Fastify registration.
 *
 * Wrapped in fastify-plugin so any request-level decorations or future
 * decorators (e.g., auth.service) are visible across the entire Fastify
 * instance, not encapsulated within this plugin scope.
 *
 * Flow:
 *   1. Decorate the request with a `null` default for `user` so any handler
 *      that forgets the `authenticate` preHandler fails safely (TypeScript
 *      compile error vs. a runtime "cannot read properties of undefined").
 *   2. Register the auth routes under /auth.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import authRoutes from './routes.js';
import { registerScimRoutes } from '../scim/scim.routes.js';
import { logger } from '../../config/logger.js';

const authLogger = logger.child({ component: 'auth-module' });

async function authModule(fastify: FastifyInstance): Promise<void> {
  // Initialize request.user to null so a misconfigured handler that reads
  // it before `authenticate` runs returns null (then crashes with a clear
  // message) rather than throwing an opaque "Cannot read properties of
  // undefined" deep in the codebase.
  if (!fastify.hasRequestDecorator('user')) {
    fastify.decorateRequest('user', null as unknown as never);
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

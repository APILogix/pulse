/**
 * Auth Module - Registration and initialization
 */

import  type { FastifyInstance } from 'fastify';
import authRoutes from './routes.js';

export async function registerAuthModule(fastify: FastifyInstance): Promise<void> {
  // Register routes with prefix
  await fastify.register(authRoutes, { prefix: '/auth' });
  
  fastify.log.info('Auth module registered');
}
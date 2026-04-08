import  type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { env } from './env.js';
export async function registerPlugins(app: FastifyInstance): Promise<void> {


  // Health check endpoint (for Kubernetes/load balancers)
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version,
  }));
  app.get("/", async () => ({ message: 'API Monitoring Backend is running' }));

  // Readiness probe (checks DB connections)
  app.get('/ready', async () => {
    // Quick DB ping checks here
    return { status: 'ready' };
  });
  app.get("/sessions",async () => {
    return { sessions: [] }; // Placeholder for actual session data
  });

  // Liveness probe (always returns 200 if process running)
  app.get('/live', async () => ({ status: 'alive' }));
}
import { buildApp } from './app.js';
import type { FastifyInstance } from 'fastify';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { closeDatabase, connectDB } from './config/database.js';

async function bootstrap() {
  let app: FastifyInstance | undefined;
  try {
    await connectDB();
    app = await buildApp();
    const server = app;

    // Graceful shutdown handling
    const closeListeners = async () => {
      logger.info('Shutting down server...');
      
      server.server.closeIdleConnections(); // Close keep-alive connections
      await server.close();
      await closeDatabase();
      
      logger.info('Server shut down complete');
      process.exit(0);
    };

    process.on('SIGTERM', closeListeners);
    process.on('SIGINT', closeListeners);

    // Start server
    await app.listen({ 
      port: env.PORT, 
      host: env.HOST,
      listenTextResolver: (address) => {
        logger.info(`Server listening at ${address}`);
        return `Server listening at ${address}`;
      },
    });

    // Log startup metrics
    logger.info({
      port: env.PORT,
      env: env.NODE_ENV,
      pid: process.pid,
      memory: process.memoryUsage(),
    }, 'Server started successfully');

  } catch (error) {
    logger.fatal(error, 'Failed to start server');
    if (app) {
      await app.close();
    }
    await closeDatabase();
    process.exit(1);
  }
}

bootstrap();

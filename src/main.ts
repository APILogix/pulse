import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

async function bootstrap() {
  try {
    const app = await buildApp();

    // Graceful shutdown handling
    const closeListeners = async () => {
      logger.info('Shutting down server...');
      
      app.server.closeIdleConnections(); // Close keep-alive connections
      
      await app.close();
      
      // Close DB connections
    //   await (await import('./config/database')).closeDatabase();
    //   await (await import('./config/redis')).closeRedis();
      
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
    process.exit(1);
  }
}

bootstrap();
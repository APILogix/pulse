import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import underPressure from '@fastify/under-pressure';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import fastifyRawBody from 'fastify-raw-body';

import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { registerHealthPlugin } from './config/plugins.js';
import { registerAuthModule } from './modules/auth/auth.module.js';
import { registerBillingModule } from './modules/billing/billing.module.js';
import registerOrganizationModule from './modules/organization/organization.module.js';
import { registerProjectsModule } from './modules/projects/projects.module.js';
import { ingestionModule } from './modules/ingestion/ingestion.module.js';
import { registerAnalyticsModule } from './modules/analytics/analytics.module.js';

declare module 'fastify' {
  interface FastifyRequest {
    startTime: number;
  }
}

const appLogger = logger.child({ component: 'app' });

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // Use loggerInstance to pass our pre-configured pino logger to Fastify.
    // This makes fastify.log.* work correctly in all modules and hooks.
    loggerInstance: logger as any,
    trustProxy: true,
    genReqId: () => `req-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    connectionTimeout: 30000,
    keepAliveTimeout: 65000,
    maxRequestsPerSocket: 1000,
    bodyLimit: 10485760, // 10MB
    routerOptions: {
      caseSensitive: false,
      ignoreTrailingSlash: true,
    },
    disableRequestLogging: true, // We handle request logging ourselves
  });

  // Zod type provider setup
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.withTypeProvider<ZodTypeProvider>();

  // ── Infrastructure Plugins ──────────────────────────────────────────
  // These MUST be registered first — they protect the server and provide
  // foundational capabilities that all modules depend on.

  await app.register(underPressure, {
    maxEventLoopDelay: 1000,
    maxHeapUsedBytes: 512 * 1024 * 1024,
    maxRssBytes: 1 * 1024 * 1024 * 1024,
    maxEventLoopUtilization: 0.98,
    pressureHandler: (_req, rep, type) => {
      appLogger.warn({ type }, 'Server under pressure');
      rep.status(503).send({ error: 'Server busy', retryAfter: 10 });
    },
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    hsts: env.NODE_ENV === 'production' ? { maxAge: 31536000 } : false,
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await app.register(compress);
  await app.register(cookie, { secret: env.JWT_SECRET });

  await app.register(fastifyRawBody, {
    field: 'rawBody',
    global: false,
    encoding: 'utf8',
    runFirst: true,
  });

  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (req: FastifyRequest) => req.ip || 'unknown',
    skipOnError: true,
  });

  await app.register(sensible);

  // ── Health & Readiness Probes ──────────────────────────────────────
  await app.register(registerHealthPlugin);

  // ── Business Modules ───────────────────────────────────────────────
  // Registration order matters: modules that provide decorators consumed
  // by later modules must be registered first. The dependency chain is:
  //
  //   ingestion (provides redisCache)
  //       └── projects (consumes redisCache)
  //
  // All other modules are independent.

  await app.register(registerAuthModule);
  await app.register(registerOrganizationModule);
  await app.register(registerBillingModule);
  await app.register(ingestionModule);          // Must be before projects
  await app.register(registerProjectsModule);   // Depends on ingestion.redisCache
  await app.register(registerAnalyticsModule);

  appLogger.info('All modules registered');

  // ── Global Error Handler ───────────────────────────────────────────
  app.setErrorHandler((error: any, request, reply) => {
    const isDev = env.NODE_ENV === 'development';

    // Validation errors → 400
    if (error.validation) {
      if (isDev) {
        appLogger.warn(
          { requestId: request.id, validation: error.validation },
          'Validation error',
        );
      }
      return reply.status(400).send({
        statusCode: 400,
        message: isDev ? error.message : 'Validation failed',
        errors: error.validation,
      });
    }

    // Fastify-specific errors
    if (error.code === 'FST_ERR_VALIDATION') {
      return reply.status(400).send({
        statusCode: 400,
        message: isDev ? error.message : 'Invalid request',
      });
    }

    // All other errors
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      appLogger.error(
        { err: error, requestId: request.id, url: request.url, method: request.method },
        'Internal server error',
      );
    }

    reply.status(statusCode).send({
      statusCode,
      message: isDev ? error.message : 'Internal Server Error',
      requestId: request.id,
      ...(isDev && { stack: error.stack }),
    });
  });

  return app;
}

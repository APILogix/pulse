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
import { randomUUID } from 'crypto';

import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { registerHealthPlugin } from './config/plugins.js';
import { registerMetricsPlugin } from './config/metrics.js';
import { registerAuthModule } from './modules/auth/auth.module.js';
import { registerBillingModule } from './modules/billing/billing.module.js';
import registerOrganizationModule from './modules/organization/organization.module.js';
import { registerProjectsModule } from './modules/projects/projects.module.js';
import { ingestionModule } from './modules/ingestion/ingestion.module.js';
import { registerAnalyticsModule } from './modules/analytics/analytics.module.js';
import { registerConnectorsModule } from './modules/connectors/connectors.module.js';
import { registerAlertingModule } from './modules/alerting/alerting.module.js';
import { registerEventAnalyticsModule } from './modules/event-analytics/event-analytics.module.js';

declare module 'fastify' {
  interface FastifyRequest {
    startTime: number;
  }
}

const appLogger = logger.child({ component: 'app' });

function buildCorsOrigin() {
  // Prod and non-prod use the same explicit allowlist. Reflecting any origin
  // with credentials=true (the previous dev behavior) lets a malicious local
  // page exfiltrate the refresh cookie. We default to localhost dev origins
  // when ALLOWED_ORIGINS is unset so engineers do not need to duplicate the
  // list in their .env.
  const allowed = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : [];
  if (env.FRONTEND_URL) allowed.push(env.FRONTEND_URL);
  if (env.APP_URL) allowed.push(env.APP_URL);

  if (env.NODE_ENV !== 'production' && allowed.length === 0) {
    return [
      'http://localhost:3000',
      'http://localhost:4000',
      'http://localhost:5173',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173',
    ];
  }
  return allowed.length > 0 ? allowed : false;
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger as any,
    trustProxy: true,
    genReqId: (req) => req.headers['x-request-id']?.toString() || randomUUID(),
    connectionTimeout: 30000,
    keepAliveTimeout: 65000,
    maxRequestsPerSocket: 1000,
    bodyLimit: 10485760, // 10MB
    routerOptions: {
      caseSensitive: false,
      ignoreTrailingSlash: true,
    },
    disableRequestLogging: true,
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
    origin: buildCorsOrigin(),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID'],
  });

  await app.register(compress, {
    threshold: 1024, // Only compress responses > 1KB
    encodings: ['br', 'gzip', 'deflate'], // Brotli first, then gzip
  });
  // Cookie plugin gets its OWN secret so a leak in JWT_SECRET cannot be used
  // to forge signed cookies and vice versa.
  await app.register(cookie, { secret: env.COOKIE_SECRET });

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
    skipOnError: false,
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded, retry in ${context.after}`,
    }),
  });

  await app.register(sensible);

  // ── Health & Readiness Probes ──────────────────────────────────────
  await app.register(registerHealthPlugin);

  // ── Prometheus Metrics ─────────────────────────────────────────────
  await app.register(registerMetricsPlugin);

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
  await app.register(registerConnectorsModule);
  await app.register(registerAlertingModule);
  await app.register(registerEventAnalyticsModule);

  appLogger.info('All modules registered');

  // ── Global Request Timing Hook ──────────────────────────────────────
  app.addHook('onRequest', async (request) => {
    request.startTime = Date.now();
  });

  app.addHook('onResponse', async (request, reply) => {
    const duration = Date.now() - request.startTime;
    // const logLevel = reply.statusCode >= 500 ? 'error' : reply.statusCode >= 400 ? 'warn' : 'debug';
    appLogger["debug"](
      {
       
        durationMs: duration,
      }
    );
  });

  // ── Global Error Handler ───────────────────────────────────────────
  app.setErrorHandler((error: any, request, reply) => {
    const isDev = env.NODE_ENV === 'development';

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

    if (error.code === 'FST_ERR_VALIDATION') {
      return reply.status(400).send({
        statusCode: 400,
        message: isDev ? error.message : 'Invalid request',
      });
    }

    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.status(413).send({
        statusCode: 413,
        message: 'Request body too large',
      });
    }

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

import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';

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
import { pool } from './config/database.js';
import { logger } from './config/logger.js';
import { registerHealthPlugin } from './config/plugins.js';
import { registerMetricsPlugin } from './config/metrics.js';
import { BackpressureGauge } from './lib/gauge.js';
import { registerHealthChecks } from './lib/health.js';
import { registerAuthModule } from './modules/auth/auth.module.js';
import { registerUserAccountModule } from './modules/user-account/user-account.module.js';
import { registerBillingModule } from './modules/billing/billing.module.js';
import registerOrganizationModule from './modules/organization/organization.module.js';
import { registerProjectsModule } from './modules/projects/projects.module.js';
import { registerSdkConfigDeliveryModule } from './modules/projects/sdk-config/sdk-config.module.js';
import { ingestionModule } from './modules/ingestion/ingestion.module.js';
import { registerAnalyticsModule } from './modules/analytics/analytics.module.js';
import { registerAnalyticsEngineModule } from './modules/analytics-engine/analytics-engine.module.js';
import { registerConnectorsModule } from './modules/connectors/connectors.module.js';
import { registerAlertingModule } from './modules/alerting/alerting.module.js';
import { registerEventAnalyticsModule } from './modules/event-analytics/event-analytics.module.js';
import { registerAIModule } from './modules/ai/ai.module.js';
import { registerAutomationModule } from './modules/automation/automation.module.js';
import { registerObservabilityModule } from './modules/observability/observability.module.js';
import { registerErrorsModule } from './modules/errors/errors.module.js';
import { errorHandler } from './shared/middleware/error-handler.js';

declare module 'fastify' {
  interface FastifyRequest {
    startTime: number;
  }
}

const appLogger = logger.child({ component: 'app' });

function buildCorsOrigin(): boolean | string[] {
  const allowed = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean)
    : [];
  if (env.FRONTEND_URL) allowed.push(env.FRONTEND_URL.replace(/\/+$/, ''));
  if (env.APP_URL) allowed.push(env.APP_URL.replace(/\/+$/, ''));

  if (env.NODE_ENV !== 'production') {
    return true;
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

  // Admission control protects latency by shedding new work before the process
  // is OOM-killed or the event loop becomes unrecoverable. Pressure logs are
  // rate-limited: logging every rejected request can itself prolong an overload.
  let lastPressureLogAt = 0;
  let suppressedPressureLogs = 0;
  await app.register(underPressure, {
    maxEventLoopDelay: env.PRESSURE_MAX_EVENT_LOOP_DELAY_MS,
    maxHeapUsedBytes: env.PRESSURE_MAX_HEAP_MB * 1024 * 1024,
    maxRssBytes: env.PRESSURE_MAX_RSS_MB * 1024 * 1024,
    maxEventLoopUtilization: env.PRESSURE_MAX_EVENT_LOOP_UTILIZATION,
    retryAfter: 10,
    pressureHandler: (_req, reply, type, value) => {
      const now = Date.now();
      if (now - lastPressureLogAt >= env.PRESSURE_LOG_INTERVAL_MS) {
        const memory = process.memoryUsage();
        appLogger.warn(
          {
            type,
            value,
            suppressedSinceLastLog: suppressedPressureLogs,
            heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
            rssMB: Math.round(memory.rss / 1024 / 1024),
          },
          'Server under pressure — shedding new work',
        );
        lastPressureLogAt = now;
        suppressedPressureLogs = 0;
      } else {
        suppressedPressureLogs += 1;
      }

      reply
        .header('Retry-After', '10')
        .status(503)
        .send({ error: 'Server busy', retryAfter: 10, reason: type });
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
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'x-api-key',
      'X-Request-ID',
      'x-request-id',
      'X-Org-Id',
      'x-org-id',
      'X-Organization-Id',
      'x-organization-id',
      'X-Project-Id',
      'x-project-id',
      'X-Environment-Id',
      'x-environment-id',
      'X-CSRF-Request',
      'x-csrf-request',
      'X-CSRF-Token',
      'x-csrf-token',
      'Idempotency-Key',
      'X-Idempotency-Key',
    ],
    exposedHeaders: ['X-Request-ID', 'ETag', 'X-Config-Revision'],
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



  await app.register(sensible);

  // ── Health & Readiness Probes ──────────────────────────────────────
  await app.register(registerHealthPlugin);
  await registerHealthChecks(app, {
    gauge: new BackpressureGauge(pool),
    maxQueueDepth: env.MAX_QUEUE_DEPTH,
    maxGaugeAgeMs: env.MAX_GAUGE_AGE_MS,
    customReadyCheck: async () => {
      try {
        await pool.query('SELECT 1');
        return { healthy: true };
      } catch {
        return { healthy: false, reason: 'database_unavailable' };
      }
    },
  });

  // ── Prometheus Metrics ─────────────────────────────────────────────
  await app.register(registerMetricsPlugin);

  // ── Business Modules ───────────────────────────────────────────────
  // Registration order matters only for explicit Fastify decorators. SDK
  // delivery is registered before ingestion because ingestion delegates SDK
  // initialization to the canonical RemoteSdkConfigService. Organization is
  // registered before projects because project services consume its decorators.
  // All control-plane caching is in-process LRU; no module depends on Redis.

  await app.register(registerAuthModule);
  await app.register(registerUserAccountModule);
  await app.register(registerSdkConfigDeliveryModule); // Canonical compiler/delivery used by init + admin
  await app.register(registerOrganizationModule);
  await app.register(registerBillingModule);
  await app.register(ingestionModule);          // Depends on sdk-config delivery
  await app.register(registerProjectsModule);
  await app.register(registerAnalyticsModule);
  // Analytics engine (v2) reads precomputed rollups only. Registered alongside
  // the v1 analytics module during the frontend migration; v1 is removed in
  // Wave 7 of docs/analytics/14-implementation-roadmap.md.
  await app.register(registerAnalyticsEngineModule);
  await app.register(registerConnectorsModule);
  await app.register(registerAlertingModule);
  await app.register(registerEventAnalyticsModule);
  await app.register(registerAIModule);
  await app.register(registerAutomationModule);
  await app.register(registerObservabilityModule);
  await app.register(registerErrorsModule);

  appLogger.info('All modules registered');

  // ── Global Request Timing Hook ──────────────────────────────────────
  app.addHook('onRequest', async (request) => {
    request.startTime = Date.now();
  });

  app.addHook('onResponse', async (request, reply) => {
    const duration = Date.now() - request.startTime;
    appLogger["debug"](
      {
        durationMs: duration,
      }
    );
  });

  // ── Global API Response Contract Enforcement Hook ──────────────────
  app.addHook('onSend', async (request, reply, payload) => {
    if (!payload || typeof payload !== 'string') return payload;
    const contentType = reply.getHeader('content-type')?.toString() || '';
    if (contentType && !contentType.includes('application/json')) return payload;

    try {
      const parsed = JSON.parse(payload);
      if (typeof parsed !== 'object' || parsed === null) return payload;

      const requestId = request.id || (reply.getHeader('x-request-id') as string) || 'req_unknown';

      // If already has canonical envelope fields, skip
      if ('success' in parsed && 'requestId' in parsed) {
        return payload;
      }

      if (reply.statusCode >= 400 || 'error' in parsed) {
        const canonicalError = {
          success: false,
          data: null,
          error: parsed.error ?? {
            code: reply.statusCode === 404 ? 'NOT_FOUND' : 'API_ERROR',
            message: parsed.message || 'Request failed',
            details: parsed.details ?? null,
          },
          meta: parsed.meta ?? null,
          requestId,
        };
        return JSON.stringify(canonicalError);
      }

      const canonicalSuccess = {
        success: true,
        data: parsed.data !== undefined ? parsed.data : parsed,
        message: parsed.message ?? null,
        meta: parsed.meta ?? null,
        requestId,
      };
      return JSON.stringify(canonicalSuccess);
    } catch {
      return payload;
    }
  });

  // ── Global Error Handler ───────────────────────────────────────────
  app.setErrorHandler(errorHandler);

  return app;
}

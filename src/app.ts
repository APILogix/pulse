import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';

import sensible from '@fastify/sensible';
import underPressure from '@fastify/under-pressure';
import {
  EnterpriseAdmissionController,
  classifyRequestTier,
  RequestTier,
} from './lib/admission-control.js';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import fastifyRawBody from 'fastify-raw-body';
import { randomUUID } from 'crypto';

import { env } from './config/env.js';
import { pool } from './config/database.js';
import { logDB } from './config/log-database.js';
import { checkPostgresHealth } from './config/postgres-network.js';
import { logger } from './config/logger.js';
import { registerHealthPlugin } from './config/plugins.js';
import { registerMetricsPlugin } from './config/metrics.js';
import { memoryDiagnostics } from './lib/memory-diagnostics.js';
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

export function parseTrustProxy(val: string): boolean | string[] {
  if (val === 'true') return true;
  if (val === 'false') return false;
  const list = val.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : true;
}

export function buildCorsOrigin(additionalAllowed?: string[]): (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => void {
  const allowed = new Set<string>();
  if (env.ALLOWED_ORIGINS) {
    for (const o of env.ALLOWED_ORIGINS.split(',')) {
      const trimmed = o.trim().replace(/\/+$/, '');
      if (trimmed) allowed.add(trimmed);
    }
  }
  if (additionalAllowed) {
    for (const o of additionalAllowed) {
      const trimmed = o.trim().replace(/\/+$/, '');
      if (trimmed) allowed.add(trimmed);
    }
  }
  if (env.FRONTEND_URL) allowed.add(env.FRONTEND_URL.replace(/\/+$/, ''));
  if (env.APP_URL) allowed.add(env.APP_URL.replace(/\/+$/, ''));

  return (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
    // H5 FIX: Allow requests with no Origin (curl, server-to-server, mobile native)
    if (!origin) {
      return cb(null, true);
    }
    const cleanOrigin = origin.replace(/\/+$/, '');
    if (allowed.has(cleanOrigin)) {
      return cb(null, true);
    }
    // In non-production, allow localhost and 127.0.0.1 on any port without reflecting arbitrary origins
    if (env.NODE_ENV !== 'production') {
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(cleanOrigin)) {
        return cb(null, true);
      }
    }
    return cb(null, false);
  };
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger as any,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
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

  // Admission control protects latency and availability through EWMA smoothing,
  // multi-sample confirmation, and tiered priority-aware load shedding.
  const admissionController = new EnterpriseAdmissionController(
    {
      maxEventLoopDelayMs: env.PRESSURE_MAX_EVENT_LOOP_DELAY_MS,
      criticalEventLoopDelayMs: env.PRESSURE_CRITICAL_EVENT_LOOP_DELAY_MS,
      maxEventLoopUtilization: env.PRESSURE_MAX_EVENT_LOOP_UTILIZATION,
      maxHeapBytes: env.PRESSURE_MAX_HEAP_MB * 1024 * 1024,
      maxRssBytes: env.PRESSURE_MAX_RSS_MB * 1024 * 1024,
      samplingIntervalMs: env.PRESSURE_SAMPLING_INTERVAL_MS,
      consecutiveBreachesRequired: env.PRESSURE_CONSECUTIVE_BREACHES,
      tieredSheddingEnabled: env.PRESSURE_TIERED_SHEDDING_ENABLED,
      logIntervalMs: env.PRESSURE_LOG_INTERVAL_MS,
    },
    appLogger,
  );
  app.addHook('onReady', async () => {
    admissionController.start();
  });
  app.addHook('onClose', async () => {
    admissionController.stop();
  });

  await app.register(underPressure, {
    // Disable plugin's internal eventLoopDelay and eventLoopUtilization checks.
    // In @fastify/under-pressure, histogram.mean is NaN when count === 0 (idle or Windows libuv tick drift),
    // causing eventLoopDelay to become Infinity, shedding all traffic falsely with value: null.
    // Both metrics are sampled via EnterpriseAdmissionController above.
    maxEventLoopDelay: 0,
    maxHeapUsedBytes: env.PRESSURE_MAX_HEAP_MB * 1024 * 1024,
    maxRssBytes: env.PRESSURE_MAX_RSS_MB * 1024 * 1024,
    maxEventLoopUtilization: 0,
    retryAfter: 10,
    pressureHandler: ((req: FastifyRequest, reply: FastifyReply, type: string) => {
      if (req.method === 'OPTIONS') return;
      reply.header('Retry-After', '10').status(503).send({ error: 'Server busy', retryAfter: 10, reason: type });
    }) as never,
  });

  app.addHook('onRequest', async (request, reply) => {
    const shedPayload = admissionController.evaluateRequest(request, reply);
    if (shedPayload) {
      return reply.send(shedPayload);
    }
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
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
      const [primaryHealth, logHealth] = await Promise.all([
        checkPostgresHealth(pool),
        logDB.healthCheck(),
      ]);
      if (!primaryHealth.healthy) {
        return { healthy: false, reason: `database_${primaryHealth.failure}` };
      }
      if (!logHealth.healthy) {
        return { healthy: false, reason: `log_database_${logHealth.failure ?? 'unavailable'}` };
      }
      return { healthy: true };
    },
  });

  // ── Prometheus Metrics ─────────────────────────────────────────────
  await app.register(registerMetricsPlugin);

  // ── Memory Diagnostics & Local Diagnostic Mode ─────────────────────
  if (env.NODE_ENV !== 'production' || env.MEMORY_DIAGNOSTICS_ENABLED) {
    app.get('/diagnostics/memory', async (_req, reply) => {
      return reply.send({
        success: true,
        data: memoryDiagnostics.getReport(),
      });
    });

    app.post('/diagnostics/gc', async (_req, reply) => {
      if (env.NODE_ENV === 'production') {
        return reply.status(403).send({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Explicit GC is strictly prohibited in production mode',
          },
        });
      }
      const result = memoryDiagnostics.triggerDiagnosticGC('http_diagnostics');
      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: result.reason || 'GC_FAILED',
            message: 'Diagnostic GC failed: ' + result.reason,
          },
        });
      }
      return reply.send({
        success: true,
        data: result,
      });
    });
  }

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
    (request as any).startTime = Date.now();
  });

  app.addHook('onResponse', async (request, reply) => {
    const duration = Date.now() - ((request as any).startTime || Date.now());
    appLogger.debug(
      {
        requestId: request.id,
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        durationMs: duration,
      },
      'Request completed'
    );
  });

  // ── Global API Response Contract Enforcement Hook ──────────────────
  // Fast preSerialization hook wraps raw JS objects BEFORE serialization,
  // avoiding expensive JSON.parse + JSON.stringify cycles in onSend.
  app.addHook('preSerialization', async (request, reply, payload) => {
    if (!payload || typeof payload !== 'object' || Buffer.isBuffer(payload)) {
      return payload;
    }

    const body = payload as Record<string, any>;

    // Skip if already has canonical envelope fields
    if ('success' in body && 'requestId' in body) {
      return payload;
    }

    const requestId = (request.id) || (reply.getHeader('x-request-id')) || 'req_unknown';

    if (reply.statusCode >= 400 || 'error' in body) {
      const errorObj =
        body.error && typeof body.error === 'object'
          ? body.error
          : {
              code:
                reply.statusCode === 404
                  ? 'NOT_FOUND'
                  : body.code || (reply.statusCode === 400 ? 'VALIDATION_ERROR' : 'API_ERROR'),
              message:
                body.message ||
                (typeof body.error === 'string' ? body.error : 'Request failed'),
              details: body.details || null,
            };

      (reply as any).__envelopeApplied = true;
      return {
        success: false,
        data: null,
        error: errorObj,
        meta: body.meta || null,
        requestId,
      };
    }

    (reply as any).__envelopeApplied = true;
    return {
      success: true,
      data: body.data !== undefined ? body.data : payload,
      message: body.message || null,
      meta: body.meta || null,
      requestId,
    };
  });

  app.addHook('onSend', async (request, reply, payload) => {
    // Fast path: preSerialization already applied the canonical contract in O(1)
    if ((reply as any).__envelopeApplied || !payload || typeof payload !== 'string') {
      return payload;
    }

    // Fast O(1) short-circuit: if already formatted with canonical envelope, skip parsing immediately
    if (payload.includes('"success"') && payload.includes('"requestId"')) {
      return payload;
    }

    const rawHeader = reply.getHeader('content-type');
    const contentType = typeof rawHeader === 'string' ? rawHeader : rawHeader ? String(rawHeader) : '';
    if (contentType && !contentType.includes('application/json')) return payload;
    // Bound payload size for automatic JSON parsing to prevent memory bloat on large analytical/export responses
    if (payload.length > 2 * 1024 * 1024) return payload;

    try {
      const parsed = JSON.parse(payload);
      if (typeof parsed !== 'object' || parsed === null) return payload;

      const body = parsed as Record<string, any>;
      const requestId = request.id || reply.getHeader('x-request-id') || 'req_unknown';

      // If already has canonical envelope fields, skip
      if ('success' in body && 'requestId' in body) {
        return payload;
      }

      if (reply.statusCode >= 400 || 'error' in body) {
        const errorObj =
          body.error && typeof body.error === 'object'
            ? body.error
            : {
                code:
                  reply.statusCode === 404
                    ? 'NOT_FOUND'
                    : body.code || (reply.statusCode === 400 ? 'VALIDATION_ERROR' : 'API_ERROR'),
                message:
                  body.message ||
                  (typeof body.error === 'string' ? body.error : 'Request failed'),
                details: body.details || null,
              };

        const canonicalError = {
          success: false,
          data: null,
          error: errorObj,
          meta: body.meta ?? null,
          requestId,
        };
        return JSON.stringify(canonicalError);
      }

      const canonicalSuccess = {
        success: true,
        data: body.data !== undefined ? body.data : parsed,
        message: body.message || null,
        meta: body.meta || null,
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

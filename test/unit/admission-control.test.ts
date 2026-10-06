import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EnterpriseAdmissionController,
  classifyRequestTier,
  RequestTier,
  AdmissionPressureState,
  type AdmissionControlConfig,
} from '../../src/lib/admission-control.js';

describe('Enterprise Admission Control', () => {
  describe('classifyRequestTier', () => {
    it('classifies OPTIONS CORS preflight as CRITICAL', () => {
      expect(classifyRequestTier('/api/v1/projects', 'OPTIONS')).toBe(RequestTier.CRITICAL);
    });

    it('classifies health and readiness probes as CRITICAL', () => {
      expect(classifyRequestTier('/health')).toBe(RequestTier.CRITICAL);
      expect(classifyRequestTier('/live')).toBe(RequestTier.CRITICAL);
      expect(classifyRequestTier('/ready')).toBe(RequestTier.CRITICAL);
      expect(classifyRequestTier('/metrics')).toBe(RequestTier.CRITICAL);
    });

    it('classifies authentication and session lifecycle endpoints as CRITICAL', () => {
      expect(classifyRequestTier('/auth/login')).toBe(RequestTier.CRITICAL);
      expect(classifyRequestTier('/auth/session')).toBe(RequestTier.CRITICAL);
      expect(classifyRequestTier('/auth/refresh')).toBe(RequestTier.CRITICAL);
      expect(classifyRequestTier('/auth/mfa/verify')).toBe(RequestTier.CRITICAL);
      expect(classifyRequestTier('/auth/logout')).toBe(RequestTier.CRITICAL);
      expect(classifyRequestTier('/auth/oauth/callback')).toBe(RequestTier.CRITICAL);
    });

    it('classifies payment billing webhooks as CRITICAL', () => {
      expect(classifyRequestTier('/billing/webhook')).toBe(RequestTier.CRITICAL);
      expect(classifyRequestTier('/webhooks/stripe')).toBe(RequestTier.CRITICAL);
    });

    it('classifies high-volume ingestion and live telemetry as SHEDDABLE', () => {
      expect(classifyRequestTier('/api/v1/telemetry')).toBe(RequestTier.SHEDDABLE);
      expect(classifyRequestTier('/api/v1/ingest')).toBe(RequestTier.SHEDDABLE);
      expect(classifyRequestTier('/ingest/batch')).toBe(RequestTier.SHEDDABLE);
      expect(classifyRequestTier('/observability/live/spans')).toBe(RequestTier.SHEDDABLE);
      expect(classifyRequestTier('/observability/live/requests')).toBe(RequestTier.SHEDDABLE);
      expect(classifyRequestTier('/analytics/export/csv')).toBe(RequestTier.SHEDDABLE);
    });

    it('classifies regular REST application endpoints as STANDARD', () => {
      expect(classifyRequestTier('/projects')).toBe(RequestTier.STANDARD);
      expect(classifyRequestTier('/organizations/org_123/settings')).toBe(RequestTier.STANDARD);
      expect(classifyRequestTier('/user-account/profile')).toBe(RequestTier.STANDARD);
      expect(classifyRequestTier('/connectors/github')).toBe(RequestTier.STANDARD);
    });
  });

  describe('EnterpriseAdmissionController state machine & tiered shedding', () => {
    let mockLogger: any;
    let mockHistogram: any;
    let count = 0;
    let mean = 0;

    const defaultConfig: AdmissionControlConfig = {
      maxEventLoopDelayMs: 1500,
      criticalEventLoopDelayMs: 3500,
      maxEventLoopUtilization: 0.95,
      maxHeapBytes: 500 * 1024 * 1024,
      maxRssBytes: 1000 * 1024 * 1024,
      samplingIntervalMs: 500,
      consecutiveBreachesRequired: 2,
      tieredSheddingEnabled: true,
      logIntervalMs: 10000,
    };

    beforeEach(() => {
      count = 0;
      mean = 0;
      mockLogger = {
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };
      mockHistogram = {
        get count() {
          return count;
        },
        get mean() {
          return mean;
        },
        enable: vi.fn(),
        disable: vi.fn(),
        reset: vi.fn(),
      };
    });

    let mockEluActive = 10;
    let mockEluIdle = 990;

    function createController(customConfig?: Partial<AdmissionControlConfig>) {
      return new EnterpriseAdmissionController(
        { ...defaultConfig, ...customConfig },
        mockLogger,
        () => mockHistogram,
        () => ({
          active: (mockEluActive += 10),
          idle: (mockEluIdle += 990),
          utilization: 0.01,
        }),
      );
    }

    function createMockRequest(url: string, method = 'GET', customRouteConfig?: any) {
      return {
        url,
        method,
        routeOptions: {
          config: customRouteConfig || {},
        },
      } as any;
    }

    function createMockReply() {
      const headers: Record<string, string> = {};
      let statusCode = 200;
      return {
        headers,
        statusCode,
        header(name: string, value: string) {
          headers[name.toLowerCase()] = value;
          return this;
        },
        status(code: number) {
          statusCode = code;
          return this;
        },
        getHeader(name: string) {
          return headers[name.toLowerCase()];
        },
      } as any;
    }

    it('initializes in HEALTHY state and permits all requests', () => {
      const controller = createController();
      const metrics = controller.getMetrics();
      expect(metrics.state).toBe(AdmissionPressureState.HEALTHY);

      const reply = createMockReply();
      const res = controller.evaluateRequest(createMockRequest('/api/v1/telemetry'), reply);
      expect(res).toBeNull();
      expect(reply.statusCode).toBe(200);
    });

    it('handles zero sample intervals safely without NaN or Infinity', () => {
      const controller = createController();
      count = 0;
      mean = NaN;

      const metrics = controller.sample();
      expect(metrics.rawDelayMs).toBe(0);
      expect(metrics.smoothedDelayMs).toBe(0);
      expect(metrics.state).toBe(AdmissionPressureState.HEALTHY);
    });

    it('requires consecutive breaches before escalating to SATURATED (resilient to single-tick jitter)', () => {
      const controller = createController();

      // Interval 1: Sudden single-tick spike of 1600ms (above 1500ms max)
      // 1600ms + 10ms resolution in nanoseconds
      count = 5;
      mean = (1600 + 10) * 1e6;
      controller.sample();

      // With alpha=0.35, smoothedDelay = 1600ms * 0.35 = 560ms (elevated, but consecutiveBreaches = 1 < 2)
      let metrics = controller.getMetrics();
      expect(metrics.consecutiveBreaches).toBe(1);
      // Because consecutiveBreaches < 2, it is not SATURATED yet!
      expect(metrics.state).not.toBe(AdmissionPressureState.SATURATED);

      // Verify that standard dashboard requests and critical auth requests are NOT shed during this jitter
      const standardReply = createMockReply();
      expect(controller.evaluateRequest(createMockRequest('/projects'), standardReply)).toBeNull();

      const authReply = createMockReply();
      expect(controller.evaluateRequest(createMockRequest('/auth/login', 'POST'), authReply)).toBeNull();
    });

    it('sheds ONLY sheddable ingestion at ELEVATED state while protecting standard and critical traffic', () => {
      const controller = createController();

      // Simulate elevated delay: 1000ms delay (> 1500ms * 0.5)
      count = 10;
      mean = (1000 + 10) * 1e6;
      controller.sample();

      const metrics = controller.getMetrics();
      expect(metrics.state).toBe(AdmissionPressureState.ELEVATED);

      // 1. Sheddable request (telemetry ingestion) MUST be shed with 503 and Retry-After: 5
      const sheddableReply = createMockReply();
      const sheddableRes = controller.evaluateRequest(createMockRequest('/api/v1/telemetry', 'POST'), sheddableReply);
      expect(sheddableRes).not.toBeNull();
      expect(sheddableRes?.error).toBe('Server busy');
      expect(sheddableRes?.retryAfter).toBe(5);
      expect(sheddableRes?.tier).toBe(RequestTier.SHEDDABLE);
      expect(sheddableReply.headers['retry-after']).toBe('5');

      // 2. Standard user dashboard request MUST be allowed through (return null)
      const standardReply = createMockReply();
      const standardRes = controller.evaluateRequest(createMockRequest('/projects'), standardReply);
      expect(standardRes).toBeNull();

      // 3. Critical auth login request MUST be allowed through (return null)
      const authReply = createMockReply();
      const authRes = controller.evaluateRequest(createMockRequest('/auth/login', 'POST'), authReply);
      expect(authRes).toBeNull();
    });

    it('sheds standard and sheddable work at SATURATED state while preserving CRITICAL auth & health', () => {
      const controller = createController();

      // Sample 1: sustained high delay
      count = 10;
      mean = (2000 + 10) * 1e6;
      controller.sample();

      // Sample 2: sustained high delay (second breach confirms saturation)
      mean = (2200 + 10) * 1e6;
      controller.sample();

      const metrics = controller.getMetrics();
      expect(metrics.consecutiveBreaches).toBeGreaterThanOrEqual(2);
      expect(metrics.state).toBe(AdmissionPressureState.SATURATED);

      // 1. Sheddable request is shed
      const sheddableReply = createMockReply();
      const sheddableRes = controller.evaluateRequest(createMockRequest('/ingest/events', 'POST'), sheddableReply);
      expect(sheddableRes).not.toBeNull();
      expect(sheddableRes?.tier).toBe(RequestTier.SHEDDABLE);

      // 2. Standard user request is shed
      const standardReply = createMockReply();
      const standardRes = controller.evaluateRequest(createMockRequest('/projects/prj_123'), standardReply);
      expect(standardRes).not.toBeNull();
      expect(standardRes?.tier).toBe(RequestTier.STANDARD);

      // 3. CRITICAL auth login is STILL PROTECTED and allowed through!
      const authReply = createMockReply();
      const authRes = controller.evaluateRequest(createMockRequest('/auth/login', 'POST'), authReply);
      expect(authRes).toBeNull();

      // 4. CRITICAL billing webhook is STILL PROTECTED!
      const webhookReply = createMockReply();
      const webhookRes = controller.evaluateRequest(createMockRequest('/billing/webhook', 'POST'), webhookReply);
      expect(webhookRes).toBeNull();
    });

    it('recovers rapidly when event loop delay clears up', () => {
      const controller = createController();

      // Push into elevated pressure
      count = 10;
      mean = (1200 + 10) * 1e6;
      controller.sample();
      expect(controller.getMetrics().state).toBe(AdmissionPressureState.ELEVATED);

      // Event loop clears: 0ms delay
      count = 10;
      mean = 10 * 1e6; // delay = 0
      controller.sample();
      controller.sample();

      const metrics = controller.getMetrics();
      expect(metrics.state).toBe(AdmissionPressureState.HEALTHY);

      // Ingestion requests immediately pass again
      const reply = createMockReply();
      expect(controller.evaluateRequest(createMockRequest('/api/v1/telemetry'), reply)).toBeNull();
    });

    it('respects route-level pressureHandler exemption (e.g. for health probes)', () => {
      const controller = createController();
      // Put controller into emergency state
      count = 10;
      mean = (4000 + 10) * 1e6;
      controller.sample();
      expect(controller.getMetrics().state).toBe(AdmissionPressureState.EMERGENCY);

      // Health route with custom pressureHandler config
      const customReply = createMockReply();
      const req = createMockRequest('/health', 'GET', { pressureHandler: () => undefined });
      const res = controller.evaluateRequest(req, customReply);
      expect(res).toBeNull();
    });

    it('protects against zero-idle artifact (does not falsely saturate on tiny timer execution with idle: 0)', () => {
      let customActive = 0;
      let customIdle = 0;
      const controller = new EnterpriseAdmissionController(
        defaultConfig,
        mockLogger,
        () => mockHistogram,
        () => ({
          active: (customActive += 0.5), // tiny 0.5ms active tick
          idle: customIdle,              // 0ms idle (libuv did not poll I/O)
          utilization: 1.0,
        }),
      );

      // Sample 1: tiny active tick with 0 idle
      controller.sample();
      expect(controller.getMetrics().utilization).toBe(0);
      expect(controller.getMetrics().state).toBe(AdmissionPressureState.HEALTHY);

      // Sample 2: another tiny active tick with 0 idle
      controller.sample();
      expect(controller.getMetrics().utilization).toBe(0);
      expect(controller.getMetrics().consecutiveBreaches).toBe(0);
      expect(controller.getMetrics().state).toBe(AdmissionPressureState.HEALTHY);
    });

    it('correctly detects genuine sustained ELU saturation when active work is genuinely high', () => {
      let customActive = 0;
      let customIdle = 0;
      const controller = new EnterpriseAdmissionController(
        defaultConfig,
        mockLogger,
        () => mockHistogram,
        () => ({
          active: (customActive += 490), // 490ms active work in 500ms window
          idle: (customIdle += 10),      // 10ms idle
          utilization: 0.98,
        }),
      );

      // Breach 1
      controller.sample();
      expect(controller.getMetrics().consecutiveBreaches).toBe(1);

      // Breach 2: confirms saturation
      controller.sample();
      expect(controller.getMetrics().consecutiveBreaches).toBe(2);
      expect(controller.getMetrics().state).toBe(AdmissionPressureState.SATURATED);
    });
  });
});

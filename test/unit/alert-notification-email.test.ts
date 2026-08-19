import { describe, expect, it } from 'vitest';
import {
  extractAlertContext,
  buildAlertNotificationPayload,
  renderEnterpriseAlertEmail,
  formatDuration,
  formatMetricValue,
  formatTimestamp,
} from '../../src/modules/alerting/runtime/alert-notification-formatter.js';
import type { AlertDecisionCandidate } from '../../src/modules/alerting/decision/decision.engine.js';

describe('Alert Notification Formatter & Enterprise Email', () => {
  describe('Helper formatting functions', () => {
    it('formats duration correctly', () => {
      expect(formatDuration(null)).toBe('n/a');
      expect(formatDuration(undefined)).toBe('n/a');
      expect(formatDuration(42)).toBe('42 ms');
      expect(formatDuration(1450)).toBe('1.45s');
      expect(formatDuration(12500)).toBe('13s');
    });

    it('formats metric values correctly based on field hints', () => {
      expect(formatMetricValue(1450, 'requests.latency_ms')).toBe('1.45s');
      expect(formatMetricValue(0.142, 'error_rate')).toBe('14.2%');
      expect(formatMetricValue(94, 'cpu_usage')).toBe('94%');
      expect(formatMetricValue(500, 'count')).toBe('500');
    });

    it('formats timestamp to UTC string', () => {
      const ts = formatTimestamp(new Date('2026-08-18T20:49:34.000Z'));
      expect(ts).toContain('18 Aug 2026');
      expect(ts).toContain('20:49:34 UTC');
    });
  });

  describe('High Latency Alert formatting', () => {
    const latencyCandidate: AlertDecisionCandidate = {
      organizationId: 'org_test_123',
      projectId: 'proj_checkout_456',
      environment: 'production',
      service: 'checkout-api',
      endpoint: '/api/v1/checkout',
      ruleRevision: 1,
      policy: {
        policyId: 'org_test_123:rule_latency_1:1',
        version: 1,
        organizationId: 'org_test_123',
        projectId: 'proj_checkout_456',
        ruleId: 'rule_latency_1',
        bindingId: 'bind_1',
        ruleRevision: 1,
        effectiveRuleHash: 'hash123',
        scope: {
          organizationId: 'org_test_123',
          projectId: 'proj_checkout_456',
          environment: 'production',
          service: 'checkout-api',
          endpoint: '/api/v1/checkout',
        },
        enabled: true,
        severity: 'critical',
        cooldownSeconds: 300,
        deduplicationWindowSeconds: 60,
        evaluationIntervalSeconds: 60,
        autoResolveAfterMinutes: 15,
        consecutiveBreaches: 1,
        conditions: [
          {
            id: 'cond_1',
            rule_id: 'rule_latency_1',
            condition_group_id: 'group_1',
            field_path: 'requests.latency_ms',
            operator: 'gt',
            threshold_value: 500,
            is_required: true,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
        thresholds: { 'requests.latency_ms': 500 },
        requestedChannels: ['email'],
      },
      source: 'telemetry.request',
      observedAt: new Date('2026-08-18T20:49:34.000Z'),
      kind: 'fired',
      observedValue: 1450,
      thresholdValue: 500,
      conditionFieldPaths: ['requests.latency_ms'],
      evidence: {
        event: {
          traceId: 'trace_8fa29c4b12e4',
          spanId: 'span_019a8f4c',
          record: {
            route: '/api/v1/checkout',
            method: 'POST',
            statusCode: 200,
            durationMs: 1450,
            ip: '192.168.1.50',
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          },
        },
        values: {
          requests: {
            latency_ms: 1450,
            status_code: 200,
          },
        },
      },
      annotations: {
        title: 'Alert: High Latency Alert',
        message: 'High Latency Alert breached (1450 vs 500)',
      },
      category: 'performance',
    };

    it('extracts complete context with route, time taken, threshold, trace ID, status code', () => {
      const ctx = extractAlertContext({ candidate: latencyCandidate });

      expect(ctx.ruleName).toBe('High Latency Alert');
      expect(ctx.severity).toBe('critical');
      expect(ctx.endpoint).toBe('/api/v1/checkout');
      expect(ctx.method).toBe('POST');
      expect(ctx.statusCode).toBe(200);
      expect(ctx.observedValue).toBe(1450);
      expect(ctx.thresholdValue).toBe(500);
      expect(ctx.timeTakenFormatted).toBe('1.45s');
      expect(ctx.thresholdFormatted).toBe('500 ms');
      expect(ctx.traceId).toBe('trace_8fa29c4b12e4');
      expect(ctx.spanId).toBe('span_019a8f4c');
      expect(ctx.clientIp).toBe('192.168.1.50');
      expect(ctx.environment).toBe('production');
      expect(ctx.isLatency).toBe(true);

      // Subject contains route and latency metrics
      expect(ctx.subject).toContain('[FIRING · CRITICAL]');
      expect(ctx.subject).toContain('/api/v1/checkout');
      expect(ctx.subject).toContain('1.45s > 500 ms');
      expect(ctx.subject).toContain('(production)');

      // Fields array contains structured key-values
      const routeField = ctx.fields.find((f) => f.label === 'Route');
      expect(routeField?.value).toBe('/api/v1/checkout');
      const timeField = ctx.fields.find((f) => f.label === 'Time Taken');
      expect(timeField?.value).toBe('1.45s');
      const traceField = ctx.fields.find((f) => f.label === 'Trace ID');
      expect(traceField?.value).toBe('trace_8fa29c4b12e4');
    });

    it('renders an enterprise-grade HTML and plaintext email for high latency alerts', () => {
      const email = renderEnterpriseAlertEmail({
        payload: buildAlertNotificationPayload(latencyCandidate),
        organizationId: latencyCandidate.organizationId,
        projectId: latencyCandidate.projectId,
      });

      expect(email.subject).toContain('[FIRING · CRITICAL]');
      expect(email.subject).toContain('/api/v1/checkout');
      expect(email.subject).toContain('1.45s');

      // HTML contains metric comparison, route, method, status code, trace ID, timestamp
      expect(email.html).toContain('1.45s');
      expect(email.html).toContain('500 ms');
      expect(email.html).toContain('/api/v1/checkout');
      expect(email.html).toContain('POST');
      expect(email.html).toContain('200');
      expect(email.html).toContain('trace_8fa29c4b12e4');
      expect(email.html).toContain('192.168.1.50');
      expect(email.html).toContain('18 Aug 2026');

      // Text contains plain text equivalent
      expect(email.text).toContain('LATENCY ALERT — CRITICAL');
      expect(email.text).toContain('/api/v1/checkout');
      expect(email.text).toContain('trace_8fa29c4b12e4');
    });
  });

  describe('5xx Error Spike Alert formatting', () => {
    const errorCandidate: AlertDecisionCandidate = {
      organizationId: 'org_test_123',
      projectId: 'proj_auth_789',
      environment: 'staging',
      service: 'auth-service',
      endpoint: '/api/v1/auth/login',
      ruleRevision: 1,
      policy: {
        policyId: 'org_test_123:rule_err_1:1',
        version: 1,
        organizationId: 'org_test_123',
        projectId: 'proj_auth_789',
        ruleId: 'rule_err_1',
        bindingId: 'bind_2',
        ruleRevision: 1,
        effectiveRuleHash: 'hash456',
        scope: {
          organizationId: 'org_test_123',
          projectId: 'proj_auth_789',
          environment: 'staging',
          service: 'auth-service',
          endpoint: '/api/v1/auth/login',
        },
        enabled: true,
        severity: 'error',
        cooldownSeconds: 300,
        deduplicationWindowSeconds: 60,
        evaluationIntervalSeconds: 60,
        autoResolveAfterMinutes: 15,
        consecutiveBreaches: 1,
        conditions: [
          {
            id: 'cond_2',
            rule_id: 'rule_err_1',
            condition_group_id: 'group_2',
            field_path: 'requests.error_rate',
            operator: 'gt',
            threshold_value: 0.05,
            is_required: true,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
        thresholds: { 'requests.error_rate': 0.05 },
        requestedChannels: ['email'],
      },
      source: 'telemetry.error',
      observedAt: new Date('2026-08-18T20:50:00.000Z'),
      kind: 'fired',
      observedValue: 0.142,
      thresholdValue: 0.05,
      conditionFieldPaths: ['requests.error_rate'],
      evidence: {
        event: {
          traceId: 'trace_err_98765',
          spanId: 'span_err_111',
          record: {
            route: '/api/v1/auth/login',
            method: 'POST',
            statusCode: 500,
            message: 'Database connection pool exhausted',
            ip: '10.0.0.1',
          },
        },
        values: {
          requests: {
            error_rate: 0.142,
            status_code: 500,
          },
          errors: {
            message: 'Database connection pool exhausted',
          },
        },
      },
      annotations: {
        title: 'Alert: 5xx Error Rate Spike',
        message: '5xx Error Rate Spike breached',
      },
      category: 'errors',
    };

    it('extracts error details, error rate, top status, and renders error spike template', () => {
      const ctx = extractAlertContext({ candidate: errorCandidate });
      expect(ctx.isError).toBe(true);
      expect(ctx.observedFormatted).toBe('14.2%');
      expect(ctx.thresholdFormatted).toBe('5%');
      expect(ctx.errorMessage).toBe('Database connection pool exhausted');
      expect(ctx.statusCode).toBe(500);

      const email = renderEnterpriseAlertEmail({
        payload: buildAlertNotificationPayload(errorCandidate),
        organizationId: errorCandidate.organizationId,
        projectId: errorCandidate.projectId,
      });

      expect(email.subject).toContain('[FIRING · ERROR]');
      expect(email.subject).toContain('/api/v1/auth/login');
      expect(email.html).toContain('14.2%');
      expect(email.html).toContain('5%');
      expect(email.html).toContain('500');
      expect(email.html).toContain('Database connection pool exhausted');
      expect(email.html).toContain('trace_err_98765');
    });
  });

  describe('Alert Recovered and Escalated templates', () => {
    it('renders a recovery notice when kind is recovered', () => {
      const email = renderEnterpriseAlertEmail({
        payload: {
          kind: 'recovered',
          ruleName: 'High Latency Alert',
          endpoint: '/api/v1/checkout',
          severity: 'warning',
          observedFormatted: '120 ms',
          projectId: 'proj_123',
          environment: 'production',
        },
      });

      expect(email.subject).toContain('[RESOLVED] High Latency Alert');
      expect(email.subject).toContain('/api/v1/checkout');
      expect(email.html).toContain('Resolved');
      expect(email.html).toContain('120 ms');
    });

    it('renders an escalation notice when escalationStep is present', () => {
      const email = renderEnterpriseAlertEmail({
        payload: {
          escalationStep: 2,
          ruleName: 'API Latency Breach',
          endpoint: '/api/v1/orders',
          severity: 'critical',
          policyName: 'On-Call Tier 2',
          projectId: 'proj_123',
          environment: 'production',
          timeTakenFormatted: '2.5s',
          traceId: 'trace_esc_123',
        },
      });

      expect(email.subject).toContain('[ESCALATED S2 · CRITICAL]');
      expect(email.subject).toContain('/api/v1/orders');
      expect(email.html).toContain('On-Call Tier 2');
      expect(email.html).toContain('Step 2');
      expect(email.html).toContain('trace_esc_123');
    });
  });
});

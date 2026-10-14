import { describe, expect, it } from 'vitest';
import {
  extractAlertContext,
  buildAlertNotificationPayload,
  renderEnterpriseAlertEmail,
  formatDuration,
  formatMetricValue,
  formatTimestamp,
  normalizeFilePath,
  extractPrimarySourceFrame,
} from '../../src/modules/alerting/runtime/alert-notification-formatter.js';
import type { AlertDecisionCandidate } from '../../src/modules/alerting/decision/decision.engine.js';

describe('Alert Notification Formatter & Enterprise Email', () => {
  describe('Helper formatting and normalization functions', () => {
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

    it('normalizes machine paths to clean application paths', () => {
      expect(normalizeFilePath('C:\\Users\\admin\\workspace\\my-app\\src\\routes\\tracing.js')).toBe('src/routes/tracing.js');
      expect(normalizeFilePath('/home/runner/work/repo/src/lib/db.ts')).toBe('src/lib/db.ts');
      expect(normalizeFilePath('/app/src/index.ts')).toBe('src/index.ts');
      expect(normalizeFilePath('node_modules/@fastify/deep/index.js')).toBe('@fastify/deep/index.js');
    });

    it('extracts primary in-app stack frame with code context', () => {
      const stack = `Error: Something failed
    at queryDatabase (C:\\Users\\admin\\workspace\\src\\db\\client.ts:42:15)
    at runQuery (C:\\Users\\admin\\workspace\\src\\routes\\users.ts:88:9)
    at processTicksAndRejections (node:internal/process/task_queues:95:5)`;

      const frames = [
        { filename: 'node_modules/express/index.js', lineno: 10, inApp: false },
        {
          filename: 'C:/Users/runner/work/src/routes/users.ts',
          lineno: 88,
          colno: 9,
          function: 'runQuery',
          inApp: true,
          preContext: ['const id = req.params.id;', 'const db = getDb();'],
          contextLine: 'const user = await db.query(id);',
          postContext: ['return res.json(user);'],
        },
      ];

      const fromFrames = extractPrimarySourceFrame(stack, frames);
      expect(fromFrames).toBeDefined();
      expect(fromFrames?.location).toBe('src/routes/users.ts:88:9');
      expect(fromFrames?.functionName).toBe('runQuery');
      expect(fromFrames?.sourceContext).toContain('> const user = await db.query(id);');
      expect(fromFrames?.sourceContext).toContain('const id = req.params.id;');

      const fromStack = extractPrimarySourceFrame(stack, null);
      expect(fromStack).toBeDefined();
      expect(fromStack?.location).toBe('src/db/client.ts:42:15');
      expect(fromStack?.functionName).toBe('queryDatabase');
    });
  });

  describe('High Latency Alert formatting (Section 9)', () => {
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
        evaluationIntervalSeconds: 300,
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
        projectName: 'Orders API',
        orgName: 'Acme Corp',
        event: {
          traceId: 'trace_8fa29c4b12e4',
          tracePublicId: 'TRC-000000052',
          spanId: 'span_019a8f4c',
          spanPublicId: 'SPN-000001293',
          record: {
            requestId: 'REQ-000000123',
            route: '/api/v1/checkout',
            method: 'POST',
            statusCode: 504,
            durationMs: 1450,
            ip: '192.168.1.50',
            release: '1.0.0',
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          },
        },
        values: {
          requests: {
            latency_ms: 1450,
            status_code: 504,
          },
        },
      },
      annotations: {
        title: 'High latency p95',
        message: 'High latency p95 breached (1450 vs 500)',
      },
      category: 'performance',
    };

    it('extracts complete context with route, time taken, threshold, trace ID, status code', () => {
      const ctx = extractAlertContext({ candidate: latencyCandidate });

      expect(ctx.ruleName).toBe('High latency p95');
      expect(ctx.severity).toBe('critical');
      expect(ctx.endpoint).toBe('/api/v1/checkout');
      expect(ctx.method).toBe('POST');
      expect(ctx.statusCode).toBe(504);
      expect(ctx.observedValue).toBe(1450);
      expect(ctx.thresholdValue).toBe(500);
      expect(ctx.differenceMs).toBe(950);
      expect(ctx.differencePercent).toBe(190);
      expect(ctx.aboveThresholdFormatted).toBe('+950 ms (+190%)');
      expect(ctx.timeTakenFormatted).toBe('1.45s');
      expect(ctx.thresholdFormatted).toBe('500 ms');
      expect(ctx.traceId).toBe('trace_8fa29c4b12e4');
      expect(ctx.tracePublicId).toBe('TRC-000000052');
      expect(ctx.spanPublicId).toBe('SPN-000001293');
      expect(ctx.requestId).toBe('REQ-000000123');
      expect(ctx.clientIp).toBe('192.168.1.50');
      expect(ctx.environment).toBe('production');
      expect(ctx.projectName).toBe('Orders API');
      expect(ctx.isLatency).toBe(true);

      // Section 8 subject format
      expect(ctx.subject).toBe('[FIRING · CRITICAL] High latency p95 — Orders API (production)');

      // Trace URL constructed properly
      expect(ctx.traceUrl).toBe('http://localhost:5173/projects/proj_checkout_456/traces/TRC-000000052');
    });

    it('assembles standard AlertNotificationPayload contract (Section 11)', () => {
      const payload = buildAlertNotificationPayload(latencyCandidate);

      expect(payload.type).toBe('alert.firing');
      expect(payload.alert.ruleName).toBe('High latency p95');
      expect(payload.alert.severity).toBe('critical');
      expect(payload.project.projectName).toBe('Orders API');
      expect(payload.project.environment).toBe('production');
      expect(payload.correlation.tracePublicId).toBe('TRC-000000052');
      expect(payload.correlation.requestId).toBe('REQ-000000123');
      expect(payload.diagnostic.kind).toBe('latency');
      expect((payload.diagnostic as any).differencePercent).toBe(190);
      expect(payload.actions.viewTrace).toBe('http://localhost:5173/projects/proj_checkout_456/traces/TRC-000000052');
      expect(payload.actions.viewAlert).toContain('/alerts/');
    });

    it('renders developer-focused HTML and plaintext email for high latency alerts (Section 9)', () => {
      const email = renderEnterpriseAlertEmail({
        payload: buildAlertNotificationPayload(latencyCandidate),
        organizationId: latencyCandidate.organizationId,
        projectId: latencyCandidate.projectId,
      });

      expect(email.subject).toBe('[FIRING · CRITICAL] High latency p95 — Orders API (production)');

      // HTML contains Performance, Request, Correlation, Actions sections
      expect(email.html).toContain('Performance');
      expect(email.html).toContain('1.45s');
      expect(email.html).toContain('500 ms');
      expect(email.html).toContain('+950 ms (+190%)');
      expect(email.html).toContain('Request');
      expect(email.html).toContain('/api/v1/checkout');
      expect(email.html).toContain('POST');
      expect(email.html).toContain('504');
      expect(email.html).toContain('Correlation');
      expect(email.html).toContain('TRC-000000052');
      expect(email.html).toContain('SPN-000001293');
      expect(email.html).toContain('REQ-000000123');
      expect(email.html).toContain('Analyze Trace');

      // Plaintext contains clean sections
      expect(email.text).toContain('LATENCY ALERT — CRITICAL');
      expect(email.text).toContain('--- PERFORMANCE ---');
      expect(email.text).toContain('--- REQUEST ---');
      expect(email.text).toContain('--- CORRELATION ---');
      expect(email.text).toContain('--- ACTIONS ---');
      expect(email.text).toContain('Analyze Trace:');
    });
  });

  describe('Developer-Focused Error Alert formatting (Section 10)', () => {
    const errorCandidate: AlertDecisionCandidate = {
      organizationId: 'org_test_123',
      projectId: 'proj_consumer_789',
      environment: 'production',
      service: 'consumer-app',
      endpoint: '/tracing/error-span',
      ruleRevision: 1,
      policy: {
        policyId: 'org_test_123:rule_err_1:1',
        version: 1,
        organizationId: 'org_test_123',
        projectId: 'proj_consumer_789',
        ruleId: 'rule_err_1',
        bindingId: 'bind_2',
        ruleRevision: 1,
        effectiveRuleHash: 'hash456',
        scope: {
          organizationId: 'org_test_123',
          projectId: 'proj_consumer_789',
          environment: 'production',
          service: 'consumer-app',
          endpoint: '/tracing/error-span',
        },
        enabled: true,
        severity: 'error',
        cooldownSeconds: 300,
        deduplicationWindowSeconds: 60,
        evaluationIntervalSeconds: 60,
        autoResolveAfterMinutes: 15,
        consecutiveBreaches: 1,
        conditions: [],
        thresholds: {},
        requestedChannels: ['email'],
      },
      source: 'telemetry.error',
      observedAt: new Date('2026-08-18T20:50:00.000Z'),
      kind: 'fired',
      conditionFieldPaths: [],
      evidence: {
        projectName: 'consumer-app',
        orgName: 'Acme Corp',
        event: {
          type: 'error',
          publicId: 'ERR-000000817',
          traceId: 'trace_err_98765',
          tracePublicId: 'TRC-000000053',
          spanId: 'span_err_111',
          spanPublicId: 'SPN-000001294',
          record: {
            name: 'SqliteError',
            message: 'no such table: non_existent_table_tracing_err',
            route: '/tracing/error-span',
            method: 'GET',
            statusCode: 500,
            fingerprint: 'fa16be65d66cbfae',
            handled: false,
            mechanism: 'unhandled',
            requestId: 'cb45b0b9-1234',
            occurrences: 1,
            firstSeenAt: '2026-08-18 20:50:00 UTC',
            lastSeenAt: '2026-08-18 20:50:00 UTC',
            framework: 'Fastify',
            stack: 'SqliteError: no such table\n    at dbQuery (C:\\Users\\dev\\src\\routes\\tracing.js:223:15)',
            stackFrames: [
              {
                filename: 'C:/Users/dev/src/routes/tracing.js',
                lineno: 223,
                function: 'child-failing-database-query',
                inApp: true,
                preContext: ['const db = getDatabase();'],
                contextLine: 'const rows = db.prepare("SELECT * FROM non_existent_table").all();',
                postContext: ['return rows;'],
              },
            ],
          },
        },
        values: {
          errors: {
            message: 'no such table: non_existent_table_tracing_err',
          },
        },
      },
      annotations: {
        title: 'Unhandled Exception',
        message: 'Unhandled SqliteError in consumer-app',
      },
      category: 'errors',
    };

    it('extracts error identity, normalized source frame, code excerpt, and builds subject', () => {
      const ctx = extractAlertContext({ candidate: errorCandidate });

      expect(ctx.isError).toBe(true);
      expect(ctx.errorType).toBe('SqliteError');
      expect(ctx.errorMessage).toBe('no such table: non_existent_table_tracing_err');
      expect(ctx.eventPublicId).toBe('ERR-000000817');
      expect(ctx.fingerprint).toBe('fa16be65d66cbfae');
      expect(ctx.handled).toBe(false);
      expect(ctx.mechanism).toBe('unhandled');
      expect(ctx.sourceFrame).toBe('src/routes/tracing.js:223');
      expect(ctx.sourceFunction).toBe('child-failing-database-query');
      expect(ctx.sourceContext).toContain('> const rows = db.prepare("SELECT * FROM non_existent_table").all();');

      // Section 8 subject format: [FIRING · ERROR] SqliteError — consumer-app (production)
      expect(ctx.subject).toBe('[FIRING · ERROR] SqliteError — consumer-app (production)');
    });

    it('renders developer-focused HTML and plaintext error alert email (Section 10)', () => {
      const email = renderEnterpriseAlertEmail({
        payload: buildAlertNotificationPayload(errorCandidate),
        organizationId: errorCandidate.organizationId,
        projectId: errorCandidate.projectId,
      });

      expect(email.subject).toBe('[FIRING · ERROR] SqliteError — consumer-app (production)');

      // HTML contains Error, Source, Request, Impact, Runtime, Trace, Actions sections
      expect(email.html).toContain('SqliteError');
      expect(email.html).toContain('no such table: non_existent_table_tracing_err');
      expect(email.html).toContain('ERR-000000817');
      expect(email.html).toContain('src/routes/tracing.js:223');
      expect(email.html).toContain('child-failing-database-query');
      expect(email.html).toContain('SELECT * FROM non_existent_table');
      expect(email.html).toContain('/tracing/error-span');
      expect(email.html).toContain('500');
      expect(email.html).toContain('TRC-000000053');
      expect(email.html).toContain('SPN-000001294');
      expect(email.html).toContain('Analyze Trace');

      // Plaintext checks
      expect(email.text).toContain('ERROR ALERT — ERROR');
      expect(email.text).toContain('--- ERROR ---');
      expect(email.text).toContain('--- SOURCE ---');
      expect(email.text).toContain('--- REQUEST ---');
      expect(email.text).toContain('--- TRACE ---');
      expect(email.text).toContain('--- ACTIONS ---');
    });
  });

  describe('Trace Link verification (Only render if traceId exists)', () => {
    it('omits traceUrl and renders fallback CTAs when traceId is absent', () => {
      const noTraceCandidate: AlertDecisionCandidate = {
        organizationId: 'org_test_123',
        projectId: 'proj_checkout_456',
        environment: 'production',
        service: 'checkout-api',
        endpoint: '/api/v1/ping',
        ruleRevision: 1,
        policy: {
          policyId: 'org_test_123:rule_ping:1',
          version: 1,
          organizationId: 'org_test_123',
          projectId: 'proj_checkout_456',
          ruleId: 'rule_ping',
          bindingId: 'bind_3',
          ruleRevision: 1,
          effectiveRuleHash: 'hash789',
          scope: {
            organizationId: 'org_test_123',
            projectId: 'proj_checkout_456',
            environment: 'production',
          },
          enabled: true,
          severity: 'warning',
          cooldownSeconds: 300,
          deduplicationWindowSeconds: 60,
          evaluationIntervalSeconds: 60,
          autoResolveAfterMinutes: 15,
          consecutiveBreaches: 1,
          conditions: [],
          thresholds: {},
          requestedChannels: ['email'],
        },
        source: 'telemetry.request',
        observedAt: new Date(),
        kind: 'fired',
        observedValue: 800,
        thresholdValue: 200,
        evidence: {
          projectName: 'ping-service',
          event: {
            record: {
              route: '/api/v1/ping',
              statusCode: 200,
            },
          },
        },
        category: 'performance',
      };

      const ctx = extractAlertContext({ candidate: noTraceCandidate });
      expect(ctx.traceUrl).toBeUndefined();

      const email = renderEnterpriseAlertEmail({
        payload: buildAlertNotificationPayload(noTraceCandidate),
        organizationId: noTraceCandidate.organizationId,
        projectId: noTraceCandidate.projectId,
      });

      expect(email.html).not.toContain('Analyze Trace');
      expect(email.html).toContain('View Alert');
    });
  });

  describe('Alert Recovered and Escalated templates', () => {
    it('renders a recovery notice when kind is recovered', () => {
      const email = renderEnterpriseAlertEmail({
        payload: {
          kind: 'recovered',
          ruleName: 'High latency p95',
          endpoint: '/api/v1/checkout',
          severity: 'warning',
          observedFormatted: '120 ms',
          projectId: 'proj_123',
          projectName: 'checkout-api',
          environment: 'production',
        },
      });

      expect(email.subject).toBe('[RESOLVED] High latency p95 — checkout-api (production)');
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
          projectName: 'orders-service',
          environment: 'production',
          timeTakenFormatted: '2.5s',
          traceId: 'trace_esc_123',
        },
      });

      expect(email.subject).toBe('[ESCALATED S2 · CRITICAL] API Latency Breach — orders-service (production)');
      expect(email.html).toContain('On-Call Tier 2');
      expect(email.html).toContain('Step 2');
      expect(email.html).toContain('trace_esc_123');
    });
  });
});


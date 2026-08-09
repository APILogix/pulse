import { describe, expect, it } from 'vitest';
import {
  assembleErrorDetail,
  assertErrorPublicId,
  isErrorPublicId,
} from '../../../../src/modules/observability/error-detail.js';

describe('Error detail assembler', () => {
  it('requires an error public id', () => {
    expect(isErrorPublicId('ERR-00000001')).toBe(true);
    expect(isErrorPublicId('REQ-00000001')).toBe(false);
    expect(isErrorPublicId('not-an-id')).toBe(false);
    expect(() => assertErrorPublicId('bad')).toThrow('Invalid error public id');
  });

  it('assembles all required fields from a raw row', () => {
    const raw = {
      id: '27470483-8189-4717-92e5-229fa46ec578',
      public_id: 'ERR-000000169',
      occurred_at: new Date('2026-08-07T12:02:24.285Z'),
      error_name: 'NotFoundError',
      message: 'Resource not found via next(err)',
      severity: 'error',
      mechanism: 'express',
      handled: true,
      method: 'GET',
      route: '/api/test/status-404-auto',
      url: 'https://api.example.com/api/test/status-404-auto',
      status_code: 404,
      status_text: 'Not Found',
      environment: 'production',
      projectName: 'API Gateway',
      projectSlug: 'api-gateway',
      service: 'api-gateway',
      server_name: 'api-server-01',
      release: '1.0.0',
      sdk_name: '@vikasbaplawat1/pulse-sdk',
      sdk_version: '3.0.0',
      trace_id: 'b30eb156f47d580ed407b2a80353a048',
      trace_public_id: 'TRC-000000001',
      error_group_id: 'e7b7e7b7-e7b7-e7b7-e7b7-e7b7e7b7e7b7',
      error_group_public_id: 'ISS-000000042',
      request_id: 'req-event-538',
      request_public_id: 'REQ-000000538',
      stack_frames: [],
      breadcrumbs: [],
      context: {},
      tags: { framework: 'express' },
      extra: {},
      metadata: { applicationName: 'consumer-app', applicationVersion: '1.0.0' },
      ai_response: null,
    };

    const result = assembleErrorDetail(raw as unknown as Record<string, unknown>, {
      errorGroupPublicId: 'ISS-000000042',
      tracePublicId: 'TRC-000000001',
      requestPublicId: 'REQ-000000538',
      logsCount: 12,
    });

    expect(result).toMatchObject({
      id: '27470483-8189-4717-92e5-229fa46ec578',
      publicId: 'ERR-000000169',
      occurredAt: '2026-08-07T12:02:24.285Z',
      error: {
        name: 'NotFoundError',
        message: 'Resource not found via next(err)',
        severity: 'error',
        handled: true,
        mechanism: 'express',
      },
      http: {
        method: 'GET',
        route: '/api/test/status-404-auto',
        url: 'https://api.example.com/api/test/status-404-auto',
        statusCode: 404,
        statusText: 'Not Found',
      },
      environment: 'production',
      project: { name: 'API Gateway', slug: 'api-gateway' },
      service: 'api-gateway',
      server: { name: 'api-server-01' },
      release: '1.0.0',
      sdk: { name: '@vikasbaplawat1/pulse-sdk', version: '3.0.0' },
      trace: { publicId: 'TRC-000000001', traceId: 'b30eb156f47d580ed407b2a80353a048' },
      errorGroup: { publicId: 'ISS-000000042' },
      request: { publicId: 'REQ-000000538' },
      debugging: { stackFrames: [], breadcrumbs: [] },
      context: {},
      tags: { framework: 'express' },
      extra: {},
      metadata: { applicationName: 'consumer-app', applicationVersion: '1.0.0' },
      aiResponse: null,
      related: {
        errorGroup: { publicId: 'ISS-000000042' },
        trace: { publicId: 'TRC-000000001' },
        request: { publicId: 'REQ-000000538' },
        logs: { count: 12 },
      },
    });
  });

  it('falls back to raw row values when related input is not provided', () => {
    const raw = {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      public_id: 'ERR-000000001',
      occurred_at: '2026-01-01T00:00:00.000Z',
      error_name: 'Error',
      message: 'Something failed',
      severity: 'error',
      handled: false,
      method: 'POST',
      route: '/api/items',
      url: 'https://example.com/api/items',
      status_code: 500,
      status_text: 'Internal Server Error',
      environment: 'staging',
      projectName: null,
      projectSlug: 'project',
      service: 'svc',
      server_name: 'srv',
      release: '1.0.0',
      sdk_name: '@sdk',
      sdk_version: '1.0.0',
      trace_id: 'trace-1',
      trace_public_id: 'TRC-000000002',
      error_group_id: null,
      error_group_public_id: 'ISS-000000003',
      request_id: 'req-1',
      request_public_id: 'REQ-000000004',
      stack_frames: [{ file: 'app.js' }],
      breadcrumbs: [{ message: 'clicked' }],
      context: { user: 'u' },
      tags: { framework: 'express' },
      extra: { detail: 'x' },
      metadata: { app: 'test' },
      ai_response: { summary: 'ai' },
    };

    const result = assembleErrorDetail(raw as unknown as Record<string, unknown>, {
      errorGroupPublicId: null,
      tracePublicId: null,
      requestPublicId: null,
      logsCount: 0,
    });

    expect(result.errorGroup.publicId).toBe('ISS-000000003');
    expect(result.trace.publicId).toBe('TRC-000000002');
    expect(result.request.publicId).toBe('REQ-000000004');
    expect(result.debugging.stackFrames).toEqual([{ file: 'app.js' }]);
    expect(result.debugging.breadcrumbs).toEqual([{ message: 'clicked' }]);
    expect(result.context).toEqual({ user: 'u' });
    expect(result.tags).toEqual({ framework: 'express' });
    expect(result.extra).toEqual({ detail: 'x' });
    expect(result.aiResponse).toEqual({ summary: 'ai' });
  });

  it('parses JSON-string context/tags/extra/metadata and defaults arrays', () => {
    const raw = {
      public_id: 'ERR-000000002',
      error_name: 'Error',
      message: 'm',
      severity: 'error',
      occurred_at: new Date().toISOString(),
      stack_frames: JSON.stringify([{ line: 1 }]),
      breadcrumbs: JSON.stringify([{ line: 2 }]),
      context: JSON.stringify({ a: 1 }),
      tags: JSON.stringify({ b: 2 }),
      extra: JSON.stringify({ c: 3 }),
      metadata: JSON.stringify({ d: 4 }),
    };

    const result = assembleErrorDetail(raw as unknown as Record<string, unknown>, {
      errorGroupPublicId: null,
      tracePublicId: null,
      requestPublicId: null,
      logsCount: 0,
    });

    expect(result.debugging.stackFrames).toEqual([{ line: 1 }]);
    expect(result.debugging.breadcrumbs).toEqual([{ line: 2 }]);
    expect(result.context).toEqual({ a: 1 });
    expect(result.tags).toEqual({ b: 2 });
    expect(result.extra).toEqual({ c: 3 });
    expect(result.metadata).toEqual({ d: 4 });
  });
});

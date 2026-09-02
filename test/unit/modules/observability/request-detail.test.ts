import { describe, expect, it } from 'vitest';
import {
  assembleRequestDetail,
  assembleRequestDeveloperTools,
  assertRequestPublicId,
  isRequestPublicId,
} from '../../../../src/modules/observability/request-detail.js';

describe('Request detail assembler', () => {
  it('requires a request public id', () => {
    expect(isRequestPublicId('REQ-00000001')).toBe(true);
    expect(isRequestPublicId('ERR-00000001')).toBe(false);
    expect(isRequestPublicId('not-an-id')).toBe(false);
    expect(() => assertRequestPublicId('bad')).toThrow('Invalid request public id');
  });

  it('assembles all required sections from a raw row', () => {
    const raw = {
      public_id: 'REQ-00000001',
      method: 'POST',
      endpoint: '/api/users',
      status_code: 201,
      duration_ms: 123,
      occurred_at: new Date('2026-01-01T00:00:00.000Z'),
      environment: 'production',
      projectName: 'Web App',
      service: 'api',
      release: 'v1.2.3',
      trace_id: 'trace-1',
      tracePublicId: 'TRC-00000001',
      request_id: 'req-1',
      session_id: 'sess-1',
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      sdk_name: '@pulse/sdk',
      sdk_version: '3.0.0',
      server_name: 'srv-1',
      browser_family: 'Chrome',
      os_name: 'Linux',
      device_type: 'desktop',
      geo_country_code: 'US',
      geo_region: 'CA',
      geo_asn: 12345,
      body_size: 56,
      response_size: 789,
      is_slow: false,
      ai_response: null,
      attributes: { custom: 'value' },
      metadata: { sdkName: '@pulse/sdk' },
      payload: {
        url: '/api/users?foo=bar',
        query: { foo: 'bar' },
        routeParameters: { id: '42' },
        headers: { 'x-request-id': 'abc' },
        responseHeaders: { 'content-type': 'application/json' },
        body: { name: 'Acme' },
        responseBody: { id: 42 },
      },
    };

    const result = assembleRequestDetail(raw as unknown as Record<string, unknown>, {
      relatedErrors: [{ publicId: 'ERR-00000002', message: 'Database timeout' }],
      logsCount: 14,
      spanCount: 7,
      tracePublicId: 'TRC-00000001',
    });

    expect(result.header).toEqual({
      publicId: 'REQ-00000001',
      method: 'POST',
      endpoint: '/api/users',
      statusCode: 201,
      duration: 123,
      timestamp: '2026-01-01T00:00:00.000Z',
      environment: 'production',
      project: 'Web App',
      service: 'api',
      release: 'v1.2.3',
      tracePublicId: 'TRC-00000001',
    });

    expect(result.summaryCards).toEqual({
      duration: 123,
      status: 201,
      responseSize: 789,
      requestSize: 56,
      spanCount: 7,
    });

    expect(result.http).toMatchObject({
      url: '/api/users?foo=bar',
      endpoint: '/api/users',
      method: 'POST',
      queryParameters: { foo: 'bar' },
      routeParameters: { id: '42' },
      requestHeaders: { 'x-request-id': 'abc' },
      responseHeaders: { 'content-type': 'application/json' },
      requestBody: { name: 'Acme' },
      responseBody: { id: 42 },
    });

    expect(result.trace).toEqual({ publicId: 'TRC-00000001' });
    expect(result.performance).toEqual({ totalDuration: 123, isSlow: false });

    expect(result.context).toMatchObject({
      user: 'user-1',
      session: 'sess-1',
      tenant: 'tenant-1',
      sdk: '@pulse/sdk@3.0.0',
      release: 'v1.2.3',
      server: 'srv-1',
      browser: 'Chrome',
      os: 'Linux',
      device: 'desktop',
      geo: { country: 'US', region: 'CA', asn: 12345 },
    });

    expect(result.metadata).toEqual({
      attributes: { custom: 'value' },
      metadata: { sdkName: '@pulse/sdk' },
    });

    expect(result.ai).toEqual({ aiResponse: null });

    expect(result.related).toEqual({
      trace: { publicId: 'TRC-00000001' },
      errors: [{ publicId: 'ERR-00000002', message: 'Database timeout' }],
      logs: { count: 14 },
    });

    expect(result.tags).toEqual([
      { key: 'environment', label: 'Environment', value: 'production' },
      { key: 'service', label: 'Service', value: 'api' },
      { key: 'release', label: 'Release', value: 'v1.2.3' },
      { key: 'sdk', label: 'SDK', value: '@pulse/sdk@3.0.0' },
      { key: 'browser', label: 'Browser', value: 'Chrome' },
      { key: 'os', label: 'OS', value: 'Linux' },
      { key: 'device', label: 'Device', value: 'desktop' },
      { key: 'method', label: 'Method', value: 'POST' },
      { key: 'status', label: 'Status', value: '201' },
    ]);
  });

  it('falls back to payload URL and omits missing optional fields', () => {
    const raw = {
      public_id: 'REQ-00000002',
      method: 'GET',
      endpoint: null,
      status_code: null,
      duration_ms: null,
      occurred_at: 'invalid',
      environment: null,
      projectName: null,
      service: null,
      release: null,
      trace_id: null,
      request_id: null,
      user_id: null,
      session_id: null,
      tenant_id: null,
      sdk_name: null,
      sdk_version: null,
      server_name: null,
      browser_family: null,
      os_name: null,
      device_type: null,
      geo_country_code: null,
      geo_region: null,
      geo_asn: null,
      body_size: null,
      response_size: null,
      is_slow: null,
      ai_response: { summary: 'ai' },
      attributes: null,
      metadata: null,
      payload: { url: '/health' },
    };

    const result = assembleRequestDetail(raw as unknown as Record<string, unknown>, {
      relatedErrors: [],
      logsCount: 0,
      spanCount: 0,
      tracePublicId: null,
    });

    expect(result.header).toMatchObject({
      publicId: 'REQ-00000002',
      method: 'GET',
      endpoint: null,
      statusCode: null,
      duration: null,
      timestamp: null,
      tracePublicId: null,
    });
    expect(result.http.url).toBe('/health');
    expect(result.http.endpoint).toBeNull();
    expect(result.ai).toEqual({ aiResponse: { summary: 'ai' } });
    expect(result.tags).toEqual([{ key: 'method', label: 'Method', value: 'GET' }]);
  });

  it('uses trace_public_id from the raw request projection when related lookup is empty', () => {
    const result = assembleRequestDetail({
      public_id: 'REQ-00000005',
      method: 'GET',
      endpoint: '/api/trace-linked',
      status_code: 200,
      duration_ms: 12,
      occurred_at: '2026-01-01T00:00:00.000Z',
      trace_id: 'trace-1',
      trace_public_id: 'TRC-00000005',
      payload: {},
    }, {
      relatedErrors: [],
      logsCount: 0,
      spanCount: 1,
      tracePublicId: null,
    });

    expect(result.header.tracePublicId).toBe('TRC-00000005');
    expect(result.trace.publicId).toBe('TRC-00000005');
    expect(result.related.trace.publicId).toBe('TRC-00000005');
  });

  it('parses JSON-string attributes and metadata', () => {
    const raw = {
      public_id: 'REQ-00000003',
      method: 'GET',
      endpoint: '/',
      status_code: 200,
      duration_ms: 1,
      occurred_at: new Date().toISOString(),
      environment: 'dev',
      projectName: 'p',
      service: 'svc',
      release: 'r',
      attributes: JSON.stringify({ a: 1 }),
      metadata: JSON.stringify({ b: 2 }),
      payload: {},
    };

    const result = assembleRequestDetail(raw as unknown as Record<string, unknown>, {
      relatedErrors: [],
      logsCount: 0,
      spanCount: 0,
      tracePublicId: null,
    });

    expect(result.metadata.attributes).toEqual({ a: 1 });
    expect(result.metadata.metadata).toEqual({ b: 2 });
  });

  it('masks sensitive keys in developer tools payloads', () => {
    const result = assembleRequestDeveloperTools({
      public_id: 'REQ-00000004',
      method: 'POST',
      endpoint: '/login',
      status_code: 200,
      duration_ms: 10,
      occurred_at: new Date('2026-01-01T00:00:00.000Z'),
      payload: {
        headers: { Authorization: 'Bearer secret', 'x-request-id': 'abc' },
        body: { password: 'hunter2', email: 'a@b.com' },
      },
      attributes: { token: 't' },
      metadata: {},
    });

    expect(result.rawSdkEvent).toEqual({
      headers: { Authorization: '[REDACTED]', 'x-request-id': 'abc' },
      body: { password: '[REDACTED]', email: 'a@b.com' },
    });
    expect((result.normalizedEvent as { attributes: Record<string, unknown> }).attributes).toEqual({
      token: '[REDACTED]',
    });
  });
});

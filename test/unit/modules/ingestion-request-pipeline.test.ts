import { describe, expect, it, vi } from 'vitest';
import { normalizeEvent } from '../../../src/modules/ingestion/pipeline/event-normalizer.js';
import { RequestEnricher } from '../../../src/modules/ingestion/pipeline/request-enrichment.js';
import { TelemetryWriter, type ScopedEvent } from '../../../src/modules/ingestion/pipeline/telemetry-writer.js';

describe('Request Event Ingestion Pipeline End-to-End Audit', () => {
  it('normalizes full SDK request event payload according to Zod bounds', () => {
    const rawSdkPayload = {
      type: 'request',
      requestId: 'f5377cb8-dbda-4ae9-aef4-9771e4c5ed4a',
      method: 'GET',
      url: '/crons/multi',
      statusCode: 200,
      latency: 3326,
      timestamp: 1785611353001,
      traceId: '6fc41fa3982cad9ddb308c5bc9909b0b',
      spanId: '850e16c5ea89c0eb',
      parentSpanId: 'span_parent_123',
      tenantId: 'load-test-tenant',
      clientIp: '3e48ef9d22e096da',
      userAgent: 'node',
      responseSize: 279,
      route: '/crons/multi',
      eventId: 'f69881c9-9343-4893-88a5-79aaae20ac7a',
      metadata: {
        sdkName: '@vikasbaplawat1/pulse-sdk',
        sdkVersion: '3.0.0',
        applicationName: 'consumer-app',
        applicationVersion: '1.0.0',
        projectId: 'e98a06d7-eadc-4665-b82b-ce2c20791632',
        environment: 'production',
        release: '1.0.0',
      },
      sessionId: 'd25e73a1-dc42-49ef-880b-1e96ed252df6',
      user: {
        id: 'load-user',
        email: 'user@example.com',
        username: 'demo-user',
        data: { segment: 'free', loginMethod: 'password' },
      },
      tags: {
        outer: 'true',
        framework: 'express',
      },
      extra: {
        tenantId: 'load-test-tenant',
        customTag: 'val1',
      },
    };

    const norm = normalizeEvent(rawSdkPayload);
    expect(norm.ok).toBe(true);
    if (!norm.ok) return;

    expect(norm.event.type).toBe('request');
    expect((norm.event as any).requestId).toBe('f5377cb8-dbda-4ae9-aef4-9771e4c5ed4a');
    expect((norm.event as any).method).toBe('GET');
    expect((norm.event as any).url).toBe('/crons/multi');
    expect((norm.event as any).statusCode).toBe(200);
    expect((norm.event as any).latency).toBe(3326);
    expect((norm.event as any).parentSpanId).toBe('span_parent_123');
  });

  it('TelemetryWriter maps every canonical column into events_requests correctly', async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const mockDb = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        queries.push({ sql, values });
        return { rowCount: 1, rows: [{ id: 'generated-uuid-1' }] };
      }),
    };

    const writer = new TelemetryWriter(mockDb as never);

    const scopedRequest: ScopedEvent = {
      orgId: 'org_11111',
      projectId: 'proj_22222',
      apiKeyName: 'pk_live_testkey',
      environment: 'production',
      event: {
        type: 'request',
        eventId: 'f69881c9-9343-4893-88a5-79aaae20ac7a',
        requestId: 'f5377cb8-dbda-4ae9-aef4-9771e4c5ed4a',
        method: 'GET',
        url: '/crons/multi',
        statusCode: 200,
        latency: 3326,
        timestamp: 1785611353001,
        traceId: '6fc41fa3982cad9ddb308c5bc9909b0b',
        spanId: '850e16c5ea89c0eb',
        parentSpanId: 'span_parent_123',
        sessionId: 'd25e73a1-dc42-49ef-880b-1e96ed252df6',
        tenantId: 'load-test-tenant',
        clientIp: '1.2.3.4',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        responseSize: 279,
        route: '/crons/multi',
        metadata: {
          sdkName: '@vikasbaplawat1/pulse-sdk',
          sdkVersion: '3.0.0',
          applicationName: 'consumer-app',
          applicationVersion: '1.0.0',
          projectId: 'e98a06d7-eadc-4665-b82b-ce2c20791632',
          environment: 'production',
          release: '1.0.0',
          serverName: 'api-server-01',
        },
        user: {
          id: 'load-user',
          email: 'user@example.com',
          username: 'demo-user',
        },
        tags: {
          outer: 'true',
          framework: 'express',
        },
        extra: {
          tenantId: 'load-test-tenant',
          customMeta: 'hello',
        },
      } as any,
    };

    const res = await writer.writeBatchDetailed([scopedRequest]);
    expect(res.totalInserted).toBe(1);

    const insertQuery = queries.find((q) => q.sql.includes('INSERT INTO events_requests'));
    expect(insertQuery).toBeDefined();

    // Verify all canonical column names exist in SQL statement
    const expectedCols = [
      'id', 'organization_id', 'project_id', 'api_key_name', 'event_id', 'request_id',
      'trace_id', 'span_id', 'parent_span_id', 'session_id', 'user_id', 'tenant_id',
      'endpoint', 'name', 'method', 'status_code', 'duration_ms', 'body_size', 'response_size',
      'span_count', 'root_span_status', 'is_partial', 'client_ip_hash', 'user_agent',
      'referer', 'geo_country_code', 'geo_region', 'geo_asn', 'browser_family',
      'browser_version_major', 'os_name', 'os_version_major', 'device_type', 'is_bot',
      'service', 'framework', 'environment', 'release', 'server_name', 'sdk_name',
      'sdk_version', 'severity', 'attributes', 'metadata', 'payload', 'occurred_at',
    ];

    for (const col of expectedCols) {
      expect(insertQuery?.sql).toContain(col);
    }

    // Verify non-existent legacy columns are NOT in SQL column list
    const nonExistentCols = ['client_ip,', 'headers,', 'query_params,', 'body,', 'application_name,', 'application_version,'];
    for (const col of nonExistentCols) {
      expect(insertQuery?.sql).not.toContain(col);
    }

    // Verify mapped values
    const vals = insertQuery?.values as unknown[];
    expect(vals[1]).toBe('org_11111');                                      // organization_id
    expect(vals[2]).toBe('proj_22222');                                     // project_id
    expect(vals[3]).toBe('pk_live_testkey');                                // api_key_name
    expect(vals[4]).toBe('f69881c9-9343-4893-88a5-79aaae20ac7a');            // event_id
    expect(vals[5]).toBe('f5377cb8-dbda-4ae9-aef4-9771e4c5ed4a');            // request_id
    expect(vals[6]).toBe('6fc41fa3982cad9ddb308c5bc9909b0b');                // trace_id
    expect(vals[7]).toBe('850e16c5ea89c0eb');                                // span_id
    expect(vals[8]).toBe('span_parent_123');                                // parent_span_id
    expect(vals[9]).toBe('d25e73a1-dc42-49ef-880b-1e96ed252df6');            // session_id
    expect(vals[10]).toBe('load-user');                                     // user_id (extracted from user.id)
    expect(vals[11]).toBe('load-test-tenant');                               // tenant_id (extracted from tenantId)
    expect(vals[12]).toBe('/crons/multi');                                  // endpoint
    expect(vals[13]).toBe('GET /crons/multi');                              // name
    expect(vals[14]).toBe('GET');                                           // method
    expect(vals[15]).toBe(200);                                             // status_code
    expect(vals[16]).toBe(3326);                                            // duration_ms
    expect(vals[18]).toBe(279);                                             // response_size
    expect(vals[34]).toBe('consumer-app');                                  // service (extracted from metadata.applicationName)
    expect(vals[35]).toBe('express');                                       // framework (extracted from tags.framework)
    expect(vals[36]).toBe('production');                                    // environment
    expect(vals[37]).toBe('1.0.0');                                         // release
    expect(vals[38]).toBe('api-server-01');                                 // server_name
    expect(vals[39]).toBe('@vikasbaplawat1/pulse-sdk');                     // sdk_name
    expect(vals[40]).toBe('3.0.0');                                         // sdk_version
    expect(vals[41]).toBe('info');                                          // severity
    expect(JSON.parse(vals[43] as string)).toMatchObject({                  // metadata
      environment: 'production',
      applicationName: 'consumer-app',
      sdkName: '@vikasbaplawat1/pulse-sdk',
    });
    expect(vals[46]).toBe(new Date(1785611353001).toISOString());            // occurred_at
  });

  it('does not block request inserts on optional GeoIP reader initialization', async () => {
    const initSpy = vi
      .spyOn(RequestEnricher.get(), 'init')
      .mockReturnValue(new Promise<void>(() => undefined));
    const mockDb = {
      query: vi.fn(async () => ({ rowCount: 1, rows: [] })),
    };
    const writer = new TelemetryWriter(mockDb as never);

    const scopedRequest: ScopedEvent = {
      orgId: 'org_11111',
      projectId: 'proj_22222',
      apiKeyName: 'pk_live_testkey',
      environment: 'production',
      event: {
        type: 'request',
        eventId: 'request-event-1',
        requestId: 'request-1',
        method: 'GET',
        url: '/health',
        statusCode: 200,
        latency: 12,
        timestamp: 1785611353001,
        clientIp: '203.0.113.20',
        userAgent: 'Mozilla/5.0 Chrome/120.0.0.0',
      } as any,
    };

    await expect(writer.writeBatchDetailed([scopedRequest])).resolves.toMatchObject({
      totalInserted: 1,
    });
    expect(initSpy).toHaveBeenCalledOnce();
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO events_requests'),
      expect.any(Array),
    );

    initSpy.mockRestore();
  });
});

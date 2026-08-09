import type { FastifyBaseLogger } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/config/database.js', () => ({ pool: {} }));

import {
  normalizePublicId,
  resolveInvestigationContext,
} from '../../../src/modules/ai/investigation-context.js';
import { AIRepositoryError } from '../../../src/modules/ai/repository.js';
import type { QueryContext } from '../../../src/modules/observability/query-engine/index.js';

describe('AI Investigation Context Resolver', () => {
  const mockOrgId = '00000000-0000-0000-0000-000000000001';
  const mockUserId = '00000000-0000-0000-0000-000000000002';
  const mockProjectId = '00000000-0000-0000-0000-000000000003';

  const mockQueryCtx: QueryContext = {
    organizationId: mockOrgId,
    userId: mockUserId,
    role: 'owner',
    plan: 'pro',
    retentionFloor: new Date(0),
    allowedProjectIds: [mockProjectId],
  };

  it('normalizes public IDs across different prefix styles', () => {
    expect(normalizePublicId('ERR-000000001', 'error')).toBe('ERR-000000001');
    expect(normalizePublicId('err_1', 'error')).toBe('ERR-000000001');
    expect(normalizePublicId('REQ-000000042', 'request')).toBe('REQ-000000042');
    expect(normalizePublicId('req_42', 'request')).toBe('REQ-000000042');
    expect(normalizePublicId('TRC-000000100', 'trace')).toBe('TRC-000000100');
    expect(normalizePublicId('trace_100', 'trace')).toBe('TRC-000000100');
    expect(normalizePublicId('LOG-000000005', 'logs')).toBe('LOG-000000005');
  });

  it('resolves an error resource and correlates related telemetry', async () => {
    const mockResolver = {
      resolve: vi.fn().mockResolvedValue(mockQueryCtx),
    };

    const mockErrorRow = {
      id: 'err-row-1',
      public_id: 'ERR-000000001',
      organization_id: mockOrgId,
      project_id: mockProjectId,
      service: 'payment-svc',
      environment: 'production',
      severity: 'critical',
      error_name: 'DatabaseConnectionTimeout',
      message: 'Failed to connect to primary replica within 5000ms',
      stack_trace: 'Error: DatabaseConnectionTimeout\n    at connect (/app/db.js:42:15)',
      fingerprint: 'fp_abc123',
      error_group_id: 'group-uuid-1',
      error_group_public_id: 'ISS-000000001',
    };

    const mockRepository = {
      fetchRawById: vi.fn().mockResolvedValue(mockErrorRow),
      fetchLatestErrorForGroup: vi.fn().mockResolvedValue(null),
      fetchErrorGroupPublicId: vi.fn().mockResolvedValue('ISS-000000001'),
    };

    const mockCorrelation = {
      correlate: vi.fn().mockResolvedValue({
        keys: { traceId: 'trace-1', requestId: 'req-1' },
        trace: { root_span_name: 'POST /checkout', total_duration_ms: 5200 },
        spanTree: null,
        spans: [{ name: 'db.connect', durationMs: 5000 }],
        logs: [{ message: 'Retrying connection pool...', level: 'warn' }],
        relatedErrors: [],
        relatedRequests: [],
        metrics: [],
        profiles: [],
        crons: [],
        counts: { errors: 1, logs: 1, spans: 1, requests: 1, metrics: 0 },
      }),
    };

    const result = await resolveInvestigationContext(
      mockOrgId,
      mockUserId,
      'error',
      'ERR-000000001',
      {
        resolver: mockResolver as any,
        repository: mockRepository as any,
        correlation: mockCorrelation as any,
      },
    );

    expect(result.aiInput.ai_mode).toBe('AI_ROOT_CAUSE_ANALYSIS');
    expect(result.aiInput.service_name).toBe('payment-svc');
    expect(result.aiInput.environment_name).toBe('production');
    expect(result.aiInput.exception_type).toBe('DatabaseConnectionTimeout');
    expect(result.aiInput.exception_message).toBe('Failed to connect to primary replica within 5000ms');
    expect(result.aiInput.error_payload?.error_group_public_id).toBe('ISS-000000001');
    expect(result.aiInput.trace).toBeDefined();
    expect(result.aiInput.spans?.length).toBe(1);
    expect(result.aiInput.logs?.length).toBe(1);
  });

  it('resolves a trace resource and maps root span and span metrics', async () => {
    const mockResolver = {
      resolve: vi.fn().mockResolvedValue(mockQueryCtx),
    };

    const mockTraceRow = {
      id: 'trace-row-1',
      public_id: 'TRC-000000001',
      trace_id: 'trc_uuid_1',
      root_span_name: 'GET /api/v1/orders',
      total_duration_ms: 1250,
      span_count: 14,
      root_span_status: 'ok',
      service: 'order-api',
      environment: 'staging',
    };

    const mockRepository = {
      fetchRawById: vi.fn().mockResolvedValue(mockTraceRow),
    };

    const mockCorrelation = {
      correlate: vi.fn().mockResolvedValue({
        keys: { traceId: 'trc_uuid_1', requestId: null },
        trace: null,
        spanTree: null,
        spans: [{ name: 'auth.verify', durationMs: 25 }, { name: 'sql.query', durationMs: 1100 }],
        logs: [{ message: 'Order query completed', level: 'info' }],
        relatedErrors: [],
        relatedRequests: [],
        metrics: [],
        profiles: [],
        crons: [],
        counts: { errors: 0, logs: 1, spans: 2, requests: 0, metrics: 0 },
      }),
    };

    const result = await resolveInvestigationContext(
      mockOrgId,
      mockUserId,
      'trace',
      'TRC-000000001',
      {
        resolver: mockResolver as any,
        repository: mockRepository as any,
        correlation: mockCorrelation as any,
      },
    );

    expect(result.aiInput.ai_mode).toBe('AI_TRACE_ANALYSIS');
    expect(result.aiInput.service_name).toBe('order-api');
    expect(result.aiInput.trace?.root_span_name).toBe('GET /api/v1/orders');
    expect(result.aiInput.trace?.total_duration_ms).toBe(1250);
    expect(result.aiInput.spans?.length).toBe(2);
  });

  it('throws NOT_FOUND when the resource does not exist or user lacks project access', async () => {
    const mockResolver = {
      resolve: vi.fn().mockResolvedValue(mockQueryCtx),
    };

    const mockRepository = {
      fetchRawById: vi.fn().mockResolvedValue(null),
      fetchLatestErrorForGroup: vi.fn().mockResolvedValue(null),
    };

    const mockCorrelation = {
      correlate: vi.fn(),
    };

    await expect(
      resolveInvestigationContext(
        mockOrgId,
        mockUserId,
        'error',
        'ERR-999999999',
        {
          resolver: mockResolver as any,
          repository: mockRepository as any,
          correlation: mockCorrelation as any,
        },
      ),
    ).rejects.toThrowError(AIRepositoryError);
  });
});

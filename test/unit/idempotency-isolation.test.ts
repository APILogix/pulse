import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { idempotency, cacheIdempotencyResponse } from '../../src/shared/middleware/idempotency.js';
import { redis } from '../../src/config/redis.js';
import { assertCacheKeyTenantScoped } from '../helpers/tenant-cache-key.helper.js';

describe('Tier 0.1: Idempotency Tenant Isolation & Safety', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.restoreAllMocks();
    vi.spyOn(redis, 'get').mockImplementation(async (key: string) => store.get(key) ?? null);
    vi.spyOn(redis, 'set').mockImplementation(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    });
    vi.spyOn(redis, 'del').mockImplementation(async (key: string) => {
      store.delete(key);
      return 1;
    });
  });

  function createMockContext(overrides: {
    orgId?: string;
    userId?: string;
    headers?: Record<string, string>;
    body?: any;
    url?: string;
    method?: string;
  }) {
    const headers = { ...overrides.headers };
    const request = {
      method: overrides.method ?? 'POST',
      url: overrides.url ?? '/api/v1/projects',
      routeOptions: { url: overrides.url ?? '/api/v1/projects' },
      headers,
      body: overrides.body ?? { name: 'Alpha' },
      user: overrides.userId
        ? {
            id: overrides.userId,
            currentOrgId: overrides.orgId,
          }
        : undefined,
      log: { warn: vi.fn(), error: vi.fn() },
    } as unknown as FastifyRequest;

    const replyHeaders: Record<string, string> = {};
    let sentStatus = 200;
    let sentPayload: any = null;

    const reply = {
      status(code: number) {
        sentStatus = code;
        return reply;
      },
      header(key: string, val: string) {
        replyHeaders[key] = val;
        return reply;
      },
      getHeaders() {
        return replyHeaders;
      },
      send(data: any) {
        sentPayload = data;
        return reply;
      },
      get statusCode() {
        return sentStatus;
      },
      get sentPayload() {
        return sentPayload;
      },
    } as unknown as FastifyReply & { statusCode: number; sentPayload: any };

    return { request, reply };
  }

  it('Tenant B with same idempotency key never receives Tenant A cached response', async () => {
    const handler = idempotency();
    const orgA = '11111111-1111-4111-8111-111111111111';
    const orgB = '22222222-2222-4222-8222-222222222222';
    const sharedKey = 'req_idempotent_test_01';

    // 1. Tenant A executes request
    const { request: reqA, reply: replyA } = createMockContext({
      orgId: orgA,
      userId: 'user_a',
      headers: { 'idempotency-key': sharedKey },
      body: { name: 'Org A Project' },
    });
    await handler(reqA, replyA);
    expect(replyA.statusCode).toBe(200);

    // Cache Tenant A's response
    await cacheIdempotencyResponse(reqA, replyA, JSON.stringify({ projectId: 'proj_org_a_secret' }));

    // 2. Tenant B executes request with same key
    const { request: reqB, reply: replyB } = createMockContext({
      orgId: orgB,
      userId: 'user_b',
      headers: { 'idempotency-key': sharedKey },
      body: { name: 'Org B Project' },
    });
    await handler(reqB, replyB);

    // Before fix: replyB receives 200 with Tenant A's payload!
    // After fix: replyB must NOT receive Tenant A's payload, it should proceed (status 200 without cached payload)
    expect(replyB.sentPayload).toBeNull();
    expect(replyB.sentPayload).not.toEqual(JSON.stringify({ projectId: 'proj_org_a_secret' }));

    // Assert that stored Redis keys are tenant scoped
    for (const key of store.keys()) {
      assertCacheKeyTenantScoped(key);
    }
    expect(Array.from(store.keys()).some((k) => k.includes(orgA))).toBe(true);
    expect(Array.from(store.keys()).some((k) => k.includes(orgB))).toBe(true);
  });

  it('Tenant B does not get false 409 when Tenant A request is in-flight', async () => {
    const handler = idempotency();
    const orgA = '11111111-1111-4111-8111-111111111111';
    const orgB = '22222222-2222-4222-8222-222222222222';
    const sharedKey = 'in_flight_test_key';

    // Tenant A sets in-flight processing marker
    const { request: reqA, reply: replyA } = createMockContext({
      orgId: orgA,
      userId: 'user_a',
      headers: { 'idempotency-key': sharedKey },
    });
    await handler(reqA, replyA);

    // Tenant B sends same key concurrently
    const { request: reqB, reply: replyB } = createMockContext({
      orgId: orgB,
      userId: 'user_b',
      headers: { 'idempotency-key': sharedKey },
    });
    await handler(reqB, replyB);

    // Before fix: replyB receives 409 conflict.
    // After fix: Tenant B proceeds normally.
    expect(replyB.statusCode).not.toBe(409);
    expect(replyB.sentPayload).toBeNull();
  });

  it('Spoofed x-org-id client header is ignored in favor of verified user org', async () => {
    const handler = idempotency();
    const legitimateOrg = '33333333-3333-4333-8333-333333333333';
    const spoofedOrg = '99999999-9999-4999-8999-999999999999';

    const { request, reply } = createMockContext({
      orgId: legitimateOrg,
      userId: 'user_spoof_test',
      headers: {
        'idempotency-key': 'spoof_key_1',
        'x-org-id': spoofedOrg,
      },
    });

    await handler(request, reply);

    // Stored key must contain legitimateOrg and NOT spoofedOrg
    const storedKeys = Array.from(store.keys());
    expect(storedKeys.length).toBe(1);
    expect(storedKeys[0]).toContain(legitimateOrg);
    expect(storedKeys[0]).not.toContain(spoofedOrg);
  });

  it('Same idempotency key with different payload body returns HTTP 422', async () => {
    const handler = idempotency();
    const orgId = '44444444-4444-4444-8444-444444444444';
    const key = 'payload_mismatch_key';

    // 1. Initial request with body { amount: 100 }
    const { request: req1, reply: reply1 } = createMockContext({
      orgId,
      userId: 'user_1',
      headers: { 'idempotency-key': key },
      body: { amount: 100 },
    });
    await handler(req1, reply1);
    await cacheIdempotencyResponse(req1, reply1, JSON.stringify({ success: true }));

    // 2. Subsequent request with same key but body { amount: 500 }
    const { request: req2, reply: reply2 } = createMockContext({
      orgId,
      userId: 'user_1',
      headers: { 'idempotency-key': key },
      body: { amount: 500 },
    });
    await handler(req2, reply2);

    expect(reply2.statusCode).toBe(422);
    expect(reply2.sentPayload?.error?.code ?? reply2.sentPayload?.error).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH');
  });

  it('Unauthenticated request with Idempotency-Key returns HTTP 400', async () => {
    const handler = idempotency();

    // Unauthenticated request
    const { request, reply } = createMockContext({
      headers: { 'idempotency-key': 'unauth_key_1' },
      userId: undefined,
      orgId: undefined,
    });

    await handler(request, reply);

    expect(reply.statusCode).toBe(400);
    expect(reply.sentPayload?.error?.code ?? reply.sentPayload?.error).toBe('INVALID_IDEMPOTENCY_CONTEXT');
  });

  it('Sensitive route opt-out does not cache tokens/secrets in Redis', async () => {
    const handler = idempotency({ disableResponseCaching: true });
    const orgId = '55555555-5555-4555-8555-555555555555';
    const key = 'sensitive_key_01';

    const { request, reply } = createMockContext({
      orgId,
      userId: 'user_sec',
      headers: { 'idempotency-key': key },
      body: { name: 'Production Key' },
    });

    await handler(request, reply);
    await cacheIdempotencyResponse(request, reply, JSON.stringify({ secretApiKey: 'sec_12345_token' }));

    // Look at store value
    for (const [k, v] of store.entries()) {
      expect(v).not.toContain('sec_12345_token');
    }
  });
});

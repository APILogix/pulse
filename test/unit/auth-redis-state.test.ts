import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  blacklistAccessToken,
  isAccessTokenBlacklisted,
  revokeAllUserTokens,
  getUserRevokeCutoff,
  accessTokenBlacklistCache,
  userRevokeCache,
} from '../../src/modules/auth/infrastructure/cache/auth.cache.js';
import { lruRateLimit } from '../../src/modules/auth/infrastructure/rate-limiting/lru-rate-limit.js';
import { redis } from '../../src/config/redis.js';

describe('Tier 0.2: Auth State Migration to Redis', () => {
  const redisStore = new Map<string, { value: string; expireAt: number }>();

  beforeEach(() => {
    redisStore.clear();
    vi.restoreAllMocks();

    vi.spyOn(redis, 'get').mockImplementation(async (key: string) => {
      const entry = redisStore.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expireAt) {
        redisStore.delete(key);
        return null;
      }
      return entry.value;
    });

    vi.spyOn(redis, 'set').mockImplementation(async (key: string, value: string, ...args: any[]) => {
      let ttlSeconds = 900;
      if (args[0] === 'EX' && typeof args[1] === 'number') {
        ttlSeconds = args[1];
      }
      redisStore.set(key, { value, expireAt: Date.now() + ttlSeconds * 1000 });
      return 'OK';
    });

    vi.spyOn(redis, 'del').mockImplementation(async (key: string) => {
      const existed = redisStore.has(key);
      redisStore.delete(key);
      return existed ? 1 : 0;
    });

    // Mock eval for atomic Lua rate limiter
    vi.spyOn(redis, 'eval').mockImplementation(async (_script: string, _numkeys: number, key: string, windowMsStr: string) => {
      const windowMs = Number(windowMsStr);
      const now = Date.now();
      const entry = redisStore.get(key);
      let count = 1;
      let ttl = windowMs;

      if (entry && now < entry.expireAt) {
        count = Number(entry.value) + 1;
        ttl = entry.expireAt - now;
        redisStore.set(key, { value: String(count), expireAt: entry.expireAt });
      } else {
        redisStore.set(key, { value: '1', expireAt: now + windowMs });
      }

      return [count, ttl];
    });
  });

  it('Logout on one client instance (Worker A) is rejected on another (Worker B)', async () => {
    const sessionId = 'session_worker_test_123';

    // Worker A logs out user and blacklists token
    await blacklistAccessToken(sessionId);

    // Simulate Worker B: Worker B has an empty local L1 cache
    accessTokenBlacklistCache.clear();

    // Before fix: Worker B only checks its local in-process LRU which is now empty -> returns false!
    // After fix: Worker B queries shared Redis -> returns true!
    const isBlacklistedOnWorkerB = await isAccessTokenBlacklisted(sessionId);
    expect(isBlacklistedOnWorkerB).toBe(true);
    expect(redisStore.has(`auth:blacklist:${sessionId}`)).toBe(true);
  });

  it('User-wide revocation on Worker A is recognized by Worker B', async () => {
    const userId = 'user_worker_test_456';

    // Worker A revokes all user sessions
    await revokeAllUserTokens(userId);

    // Simulate Worker B: Worker B has an empty local L1 cache
    userRevokeCache.clear();

    // Before fix: Worker B returns null!
    // After fix: Worker B retrieves cutoff timestamp from Redis!
    const cutoffOnWorkerB = await getUserRevokeCutoff(userId);
    expect(cutoffOnWorkerB).not.toBeNull();
    expect(typeof cutoffOnWorkerB).toBe('number');
    expect(cutoffOnWorkerB).toBeGreaterThan(0);
    expect(redisStore.has(`auth:cutoff:${userId}`)).toBe(true);
  });

  it('Auth rate limit is shared across two simulated workers', async () => {
    const limiter = lruRateLimit({
      max: 3,
      windowMs: 60_000,
      scope: 'auth:login',
      keyGenerator: () => 'shared_attacker_ip',
    });

    function createMockRequest() {
      let statusCode = 200;
      let sentData: any = null;
      const headers: Record<string, string> = {};

      const req = {
        ip: '192.168.1.100',
        log: { warn: vi.fn(), error: vi.fn() },
      } as unknown as FastifyRequest;

      const reply = {
        status(code: number) {
          statusCode = code;
          return reply;
        },
        header(k: string, v: string) {
          headers[k] = v;
          return reply;
        },
        send(data: any) {
          sentData = data;
          return reply;
        },
        get statusCode() {
          return statusCode;
        },
        get sentData() {
          return sentData;
        },
      } as unknown as FastifyReply & { statusCode: number; sentData: any };

      return { req, reply };
    }

    // Worker A processes 2 requests
    const r1 = createMockRequest();
    await limiter(r1.req, r1.reply);
    expect(r1.reply.statusCode).toBe(200);

    const r2 = createMockRequest();
    await limiter(r2.req, r2.reply);
    expect(r2.reply.statusCode).toBe(200);

    // Worker B processes 3rd request (should still pass)
    const r3 = createMockRequest();
    await limiter(r3.req, r3.reply);
    expect(r3.reply.statusCode).toBe(200);

    // Worker B processes 4th request (should be RATE LIMITED 429)
    // Before fix: Worker B had its own process counter (count=2) so it allowed 4th request!
    // After fix: shared Redis counter reaches 4 > max(3) -> 429!
    const r4 = createMockRequest();
    await limiter(r4.req, r4.reply);
    expect(r4.reply.statusCode).toBe(429);
    expect(redis.eval).toHaveBeenCalled();
  });

  it('Redis failure: rate limiter fails closed for login/MFA and open for other routes', async () => {
    // Break Redis mock to simulate Redis outage
    vi.spyOn(redis, 'eval').mockRejectedValue(new Error('ECONNREFUSED'));
    vi.spyOn(redis, 'get').mockRejectedValue(new Error('ECONNREFUSED'));

    const loginLimiter = lruRateLimit({
      max: 5,
      windowMs: 60_000,
      scope: 'auth:login',
      keyGenerator: () => 'client_ip_1',
    });

    const otherLimiter = lruRateLimit({
      max: 5,
      windowMs: 60_000,
      scope: 'public:info',
      keyGenerator: () => 'client_ip_1',
    });

    function createMockRequest() {
      let statusCode = 200;
      let sentData: any = null;
      const req = {
        ip: '192.168.1.100',
        log: { warn: vi.fn(), error: vi.fn() },
      } as unknown as FastifyRequest;

      const reply = {
        status(code: number) {
          statusCode = code;
          return reply;
        },
        header: vi.fn(),
        send(data: any) {
          sentData = data;
          return reply;
        },
        get statusCode() {
          return statusCode;
        },
        get sentData() {
          return sentData;
        },
      } as unknown as FastifyReply & { statusCode: number; sentData: any };

      return { req, reply };
    }

    // 1. Critical login route: must FAIL CLOSED (reject request)
    const loginReq = createMockRequest();
    await loginLimiter(loginReq.req, loginReq.reply);
    expect(loginReq.reply.statusCode).toBe(503);

    // 2. Non-critical route: must FAIL OPEN (allow request)
    const otherReq = createMockRequest();
    await otherLimiter(otherReq.req, otherReq.reply);
    expect(otherReq.reply.statusCode).toBe(200);
  });
});

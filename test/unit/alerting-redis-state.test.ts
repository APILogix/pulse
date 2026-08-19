import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AlertRedisStateService,
  buildCooldownKey,
  buildFiringGateKey,
} from '../../src/modules/alerting/runtime/alert-redis-state.js';
import type { Redis } from 'ioredis';

class MockRedis {
  private readonly store = new Map<string, { value: string; expiresAt: number | null }>();

  async set(key: string, value: string, ...args: (string | number)[]): Promise<'OK' | null> {
    const isNx = args.includes('NX');
    const exIdx = args.indexOf('EX');
    const ttlSeconds = exIdx !== -1 ? Number(args[exIdx + 1]) : null;

    const now = Date.now();
    const existing = this.store.get(key);
    if (existing && (existing.expiresAt === null || existing.expiresAt > now)) {
      if (isNx) {
        return null;
      }
    }

    const expiresAt = ttlSeconds !== null ? now + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiresAt !== null && item.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async exists(key: string): Promise<number> {
    const val = await this.get(key);
    return val !== null ? 1 : 0;
  }

  clear(): void {
    this.store.clear();
  }
}

describe('AlertRedisStateService', () => {
  let mockRedis: MockRedis;
  let service: AlertRedisStateService;

  beforeEach(() => {
    mockRedis = new MockRedis();
    service = new AlertRedisStateService({
      redisClient: mockRedis as unknown as Redis,
      enabled: true,
    });
  });

  describe('Key Namespace & Format', () => {
    it('generates canonical cooldown keys with tenant and project isolation', () => {
      const key1 = buildCooldownKey('org-123', 'proj-456', 'rule-789', 'fp-abc');
      expect(key1).toBe('alert:v1:cooldown:org-123:proj-456:rule-789:fp-abc');

      const keyOrgLevel = buildCooldownKey('org-123', null, 'rule-789', 'fp-abc');
      expect(keyOrgLevel).toBe('alert:v1:cooldown:org-123:org:rule-789:fp-abc');
    });

    it('generates canonical firing gate keys', () => {
      const key = buildFiringGateKey('org-123', 'proj-456', 'rule-789', 'fp-abc');
      expect(key).toBe('alert:v1:firing:org-123:proj-456:rule-789:fp-abc');
    });
  });

  describe('Atomic Cooldown Acquisition', () => {
    it('successfully acquires cooldown on first attempt', async () => {
      const result = await service.acquireCooldown({
        organizationId: 'org-1',
        projectId: 'proj-1',
        ruleId: 'rule-1',
        fingerprint: 'fp-1',
        cooldownSeconds: 300,
        workerId: 'worker-a',
        tier: 'fast',
      });

      expect(result.acquired).toBe(true);
      expect(result.inCooldown).toBe(false);
      expect(result.fallback).toBeUndefined();
    });

    it('rejects subsequent attempts during the active cooldown window', async () => {
      const first = await service.acquireCooldown({
        organizationId: 'org-1',
        projectId: 'proj-1',
        ruleId: 'rule-1',
        fingerprint: 'fp-1',
        cooldownSeconds: 300,
        workerId: 'worker-a',
        tier: 'fast',
      });
      expect(first.acquired).toBe(true);

      const second = await service.acquireCooldown({
        organizationId: 'org-1',
        projectId: 'proj-1',
        ruleId: 'rule-1',
        fingerprint: 'fp-1',
        cooldownSeconds: 300,
        workerId: 'worker-b',
        tier: 'fast',
      });
      expect(second.acquired).toBe(false);
      expect(second.inCooldown).toBe(true);
    });

    it('allows zero or negative cooldown without persisting key', async () => {
      const result1 = await service.acquireCooldown({
        organizationId: 'org-1',
        projectId: 'proj-1',
        ruleId: 'rule-1',
        fingerprint: 'fp-1',
        cooldownSeconds: 0,
      });
      expect(result1.acquired).toBe(true);
      expect(result1.inCooldown).toBe(false);

      // Second attempt also succeeds immediately
      const result2 = await service.acquireCooldown({
        organizationId: 'org-1',
        projectId: 'proj-1',
        ruleId: 'rule-1',
        fingerprint: 'fp-1',
        cooldownSeconds: 0,
      });
      expect(result2.acquired).toBe(true);
      expect(result2.inCooldown).toBe(false);
    });

    it('allows clearing cooldown manually', async () => {
      await service.acquireCooldown({
        organizationId: 'org-1',
        projectId: 'proj-1',
        ruleId: 'rule-1',
        fingerprint: 'fp-1',
        cooldownSeconds: 300,
      });

      const cleared = await service.clearCooldown('org-1', 'proj-1', 'rule-1', 'fp-1');
      expect(cleared).toBe(true);

      const retry = await service.acquireCooldown({
        organizationId: 'org-1',
        projectId: 'proj-1',
        ruleId: 'rule-1',
        fingerprint: 'fp-1',
        cooldownSeconds: 300,
      });
      expect(retry.acquired).toBe(true);
    });
  });

  describe('Tenant & Scope Isolation', () => {
    it('isolates cooldown between different organizations', async () => {
      await service.acquireCooldown({
        organizationId: 'org-A',
        projectId: 'proj-1',
        ruleId: 'rule-1',
        fingerprint: 'fp-shared',
        cooldownSeconds: 300,
      });

      // Org B with same project/rule/fingerprint is NOT in cooldown
      const orgBResult = await service.acquireCooldown({
        organizationId: 'org-B',
        projectId: 'proj-1',
        ruleId: 'rule-1',
        fingerprint: 'fp-shared',
        cooldownSeconds: 300,
      });

      expect(orgBResult.acquired).toBe(true);
      expect(orgBResult.inCooldown).toBe(false);
    });

    it('isolates cooldown between different projects in the same organization', async () => {
      await service.acquireCooldown({
        organizationId: 'org-A',
        projectId: 'proj-Alpha',
        ruleId: 'rule-1',
        fingerprint: 'fp-shared',
        cooldownSeconds: 300,
      });

      const projBetaResult = await service.acquireCooldown({
        organizationId: 'org-A',
        projectId: 'proj-Beta',
        ruleId: 'rule-1',
        fingerprint: 'fp-shared',
        cooldownSeconds: 300,
      });

      expect(projBetaResult.acquired).toBe(true);
      expect(projBetaResult.inCooldown).toBe(false);
    });
  });

  describe('Multi-Worker Race Condition', () => {
    it('ensures exactly 1 worker acquires the gate when 10 workers race concurrently', async () => {
      const workerCount = 10;
      const promises = Array.from({ length: workerCount }, (_, i) =>
        service.acquireCooldown({
          organizationId: 'org-race',
          projectId: 'proj-race',
          ruleId: 'rule-race',
          fingerprint: 'fp-race',
          cooldownSeconds: 300,
          workerId: `worker-${i}`,
          tier: 'fast',
        }),
      );

      const results = await Promise.all(promises);
      const acquiredCount = results.filter((r) => r.acquired && !r.inCooldown).length;
      const rejectedCount = results.filter((r) => !r.acquired && r.inCooldown).length;

      expect(acquiredCount).toBe(1);
      expect(rejectedCount).toBe(workerCount - 1);
    });
  });

  describe('Fail-Safe & Fallback on Redis Error', () => {
    it('fails open to database evaluation state if Redis throws an exception', async () => {
      const faultyRedis = {
        set: vi.fn().mockRejectedValue(new Error('Connection lost to Redis cluster')),
        get: vi.fn().mockRejectedValue(new Error('Connection lost to Redis cluster')),
        del: vi.fn().mockRejectedValue(new Error('Connection lost to Redis cluster')),
      } as unknown as Redis;

      const fallbackService = new AlertRedisStateService({
        redisClient: faultyRedis,
        enabled: true,
      });

      const result = await fallbackService.acquireCooldown({
        organizationId: 'org-1',
        projectId: 'proj-1',
        ruleId: 'rule-1',
        fingerprint: 'fp-1',
        cooldownSeconds: 300,
      });

      // Fail-open returns acquired: true with fallback: true
      expect(result.acquired).toBe(true);
      expect(result.inCooldown).toBe(false);
      expect(result.fallback).toBe(true);
    });
  });
});

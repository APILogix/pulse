import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeRoute } from '../../src/modules/alerting/runtime/route-normalizer.js';
import {
  computeAlertFingerprint,
  resolveGroupingDimensions,
} from '../../src/modules/alerting/runtime/alert-fingerprint.js';
import { AlertRedisStateService } from '../../src/modules/alerting/runtime/alert-redis-state.js';
import type { Redis } from 'ioredis';

class MockRedis {
  public store = new Map<string, { value: string; expiresAt: number | null }>();

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
    return (await this.get(key)) !== null ? 1 : 0;
  }
}

describe('Route Normalization & Route-Scoped Alert Cooldown', () => {
  describe('normalizeRoute()', () => {
    it('normalizes integer IDs to :id', () => {
      expect(normalizeRoute('/users/123')).toBe('/users/:id');
      expect(normalizeRoute('/users/456')).toBe('/users/:id');
      expect(normalizeRoute('/users/123/posts/789')).toBe('/users/:id/posts/:id');
    });

    it('normalizes UUIDs to :id', () => {
      expect(normalizeRoute('/projects/123e4567-e89b-12d3-a456-426614174000')).toBe('/projects/:id');
      expect(normalizeRoute('/projects/123e4567-e89b-12d3-a456-426614174000/details')).toBe('/projects/:id/details');
    });

    it('normalizes MongoDB ObjectIDs and prefixed IDs', () => {
      expect(normalizeRoute('/items/507f1f77bcf86cd799439011')).toBe('/items/:id');
      expect(normalizeRoute('/org/org_abc12345/members')).toBe('/org/:id/members');
      expect(normalizeRoute('/users/usr_99887766/settings')).toBe('/users/:id/settings');
    });

    it('strips query strings, hashes, and protocol prefixes', () => {
      expect(normalizeRoute('https://api.pulse.dev/v1/users/123?page=2&sort=desc#profile')).toBe('/v1/users/:id');
      expect(normalizeRoute('http://localhost:3000/orders/456?debug=1')).toBe('/orders/:id');
    });

    it('collapses duplicate slashes and trims trailing slashes', () => {
      expect(normalizeRoute('///api///v1//users//123///')).toBe('/api/v1/users/:id');
      expect(normalizeRoute('')).toBe('/');
      expect(normalizeRoute(null as any)).toBe('/');
    });
  });

  describe('computeAlertFingerprint() & Grouping Dimensions', () => {
    it('generates distinct fingerprints for different routes when groupBy: ["route"] is configured', () => {
      const fpUser = computeAlertFingerprint({
        organizationId: 'org-1',
        projectId: 'proj-1',
        environment: 'production',
        ruleId: 'high-latency-rule',
        groupBy: ['route'],
        payload: {
          values: { requests: { route: '/user', latency_ms: 500 } },
        } as any,
      });

      const fpOrgUpdate = computeAlertFingerprint({
        organizationId: 'org-1',
        projectId: 'proj-1',
        environment: 'production',
        ruleId: 'high-latency-rule',
        groupBy: ['route'],
        payload: {
          values: { requests: { route: '/org/update', latency_ms: 700 } },
        } as any,
      });

      expect(fpUser.fingerprint).not.toBe(fpOrgUpdate.fingerprint);
      expect(fpUser.dimensionKey).toBe('route=/user');
      expect(fpOrgUpdate.dimensionKey).toBe('route=/org/update');
    });

    it('generates the SAME fingerprint for dynamic paths matching the same route template', () => {
      const fpUser123 = computeAlertFingerprint({
        organizationId: 'org-1',
        projectId: 'proj-1',
        environment: 'production',
        ruleId: 'high-latency-rule',
        groupBy: ['route'],
        payload: {
          values: { requests: { route: '/users/123', latency_ms: 600 } },
        } as any,
      });

      const fpUser456 = computeAlertFingerprint({
        organizationId: 'org-1',
        projectId: 'proj-1',
        environment: 'production',
        ruleId: 'high-latency-rule',
        groupBy: ['route'],
        payload: {
          values: { requests: { route: '/users/456', latency_ms: 800 } },
        } as any,
      });

      expect(fpUser123.fingerprint).toBe(fpUser456.fingerprint);
      expect(fpUser123.dimensionKey).toBe('route=/users/:id');
    });

    it('filters out disallowed high-cardinality grouping dimensions to prevent memory growth', () => {
      const allowed = resolveGroupingDimensions({
        organizationId: 'org-1',
        ruleId: 'rule-1',
        groupBy: ['route', 'request_id', 'user_id', 'trace_id', 'timestamp', 'service'],
      });

      expect(allowed).toContain('route');
      expect(allowed).toContain('service');
      expect(allowed).not.toContain('request_id');
      expect(allowed).not.toContain('user_id');
      expect(allowed).not.toContain('trace_id');
      expect(allowed).not.toContain('timestamp');
    });

    it('produces a global fingerprint for rules without grouping', () => {
      const fp = computeAlertFingerprint({
        organizationId: 'org-1',
        projectId: 'proj-1',
        environment: 'production',
        ruleId: 'global-rule',
        groupBy: null,
      });

      expect(fp.dimensionKey).toBe('global');
    });
  });

  describe('Route-Scoped Redis Cooldown Edge-Case End-to-End', () => {
    let mockRedis: MockRedis;
    let service: AlertRedisStateService;

    beforeEach(() => {
      mockRedis = new MockRedis();
      service = new AlertRedisStateService({
        redisClient: mockRedis as unknown as Redis,
        enabled: true,
      });
    });

    it('ensures /user in cooldown does NOT suppress /org/update, while repeated /user is suppressed', async () => {
      // 1. /user triggers latency breach -> acquires 60s cooldown
      const fpUser = computeAlertFingerprint({
        organizationId: 'org-1',
        projectId: 'proj-1',
        environment: 'production',
        ruleId: 'high-latency-rule',
        groupBy: ['route'],
        payload: { values: { requests: { route: '/user' } } } as any,
      });

      const resUser1 = await service.acquireCooldown({
        organizationId: 'org-1',
        projectId: 'proj-1',
        ruleId: 'high-latency-rule',
        fingerprint: fpUser.fingerprint,
        cooldownSeconds: 60,
      });
      expect(resUser1.acquired).toBe(true);
      expect(resUser1.inCooldown).toBe(false);

      // 2. /org/update triggers latency breach 5s later -> acquires INDEPENDENT 60s cooldown!
      const fpOrgUpdate = computeAlertFingerprint({
        organizationId: 'org-1',
        projectId: 'proj-1',
        environment: 'production',
        ruleId: 'high-latency-rule',
        groupBy: ['route'],
        payload: { values: { requests: { route: '/org/update' } } } as any,
      });

      const resOrgUpdate = await service.acquireCooldown({
        organizationId: 'org-1',
        projectId: 'proj-1',
        ruleId: 'high-latency-rule',
        fingerprint: fpOrgUpdate.fingerprint,
        cooldownSeconds: 60,
      });
      // CRITICAL: /org/update is NOT suppressed even though /user is currently in cooldown!
      expect(resOrgUpdate.acquired).toBe(true);
      expect(resOrgUpdate.inCooldown).toBe(false);

      // 3. /user triggers AGAIN 10s later -> SUPPRESSED by active /user cooldown!
      const resUser2 = await service.acquireCooldown({
        organizationId: 'org-1',
        projectId: 'proj-1',
        ruleId: 'high-latency-rule',
        fingerprint: fpUser.fingerprint,
        cooldownSeconds: 60,
      });
      expect(resUser2.acquired).toBe(false);
      expect(resUser2.inCooldown).toBe(true);

      // 4. /users/123 triggers -> normalized to /users/:id -> acquires cooldown
      const fpUser123 = computeAlertFingerprint({
        organizationId: 'org-1',
        projectId: 'proj-1',
        environment: 'production',
        ruleId: 'high-latency-rule',
        groupBy: ['route'],
        payload: { values: { requests: { route: '/users/123' } } } as any,
      });
      const resUser123 = await service.acquireCooldown({
        organizationId: 'org-1',
        projectId: 'proj-1',
        ruleId: 'high-latency-rule',
        fingerprint: fpUser123.fingerprint,
        cooldownSeconds: 60,
      });
      expect(resUser123.acquired).toBe(true);

      // 5. /users/456 triggers 5s later -> normalized to same /users/:id -> SUPPRESSED!
      const fpUser456 = computeAlertFingerprint({
        organizationId: 'org-1',
        projectId: 'proj-1',
        environment: 'production',
        ruleId: 'high-latency-rule',
        groupBy: ['route'],
        payload: { values: { requests: { route: '/users/456' } } } as any,
      });
      const resUser456 = await service.acquireCooldown({
        organizationId: 'org-1',
        projectId: 'proj-1',
        ruleId: 'high-latency-rule',
        fingerprint: fpUser456.fingerprint,
        cooldownSeconds: 60,
      });
      expect(resUser456.acquired).toBe(false);
      expect(resUser456.inCooldown).toBe(true);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getRedisClientForPrefix,
  classifyRedisKey,
  redisCache,
  redisState,
  createRedisClient,
  REDIS_KEY_MAPPING,
} from '../../src/config/redis.js';

describe('Tier 0.4: Redis Separation (Cache vs State)', () => {
  it('Classifies State prefixes to state store (noeviction, AOF everysec)', () => {
    // State: streams, rate limits, idempotency, alert cooldowns, remote-config, sessions/auth state
    expect(classifyRedisKey('ratelimit:login:127.0.0.1')).toBe('state');
    expect(classifyRedisKey('ingest:ratelimit:proj1:window')).toBe('state');
    expect(classifyRedisKey('idempotency:org1:u1:GET:/test:key1')).toBe('state');
    expect(classifyRedisKey('ingest:idempotency:evt123')).toBe('state');
    expect(classifyRedisKey('auth:blacklist:token123')).toBe('state');
    expect(classifyRedisKey('auth:revoked_before:u1')).toBe('state');
    expect(classifyRedisKey('auth:mfa:u1')).toBe('state');
    expect(classifyRedisKey('remote-config:proj1:production')).toBe('state');
    expect(classifyRedisKey('alert:cooldown:rule1:org1')).toBe('state');
    expect(classifyRedisKey('stream:telemetry:ingest')).toBe('state');
    expect(classifyRedisKey('security:ip:jail:1.2.3.4')).toBe('state');
  });

  it('Classifies Cache prefixes to cache store (allkeys-lru, volatile)', () => {
    // Cache: lookup caches, dashboard results, event caches
    expect(classifyRedisKey('lookup:apikey:hash123')).toBe('cache');
    expect(classifyRedisKey('lookup:sdk-config:env:env123')).toBe('cache');
    expect(classifyRedisKey('lookup:org:override:org1')).toBe('cache');
    expect(classifyRedisKey('lookup:init:hash1:hint1')).toBe('cache');
    expect(classifyRedisKey('dashboard:overview:org1:2026-10-16')).toBe('cache');
    expect(classifyRedisKey('analytics:query:hash456')).toBe('cache');
    expect(classifyRedisKey('ingest:event:evt789')).toBe('cache');
  });

  it('getRedisClientForPrefix routes properly to redisCache or redisState', () => {
    expect(getRedisClientForPrefix('idempotency:test')).toBe(redisState);
    expect(getRedisClientForPrefix('lookup:apikey:test')).toBe(redisCache);
  });

  it('Defaults REDIS_CACHE_URL and REDIS_STATE_URL to REDIS_URL when unconfigured', () => {
    const fallbackClient = createRedisClient({
      role: 'cache',
      customUrl: undefined,
      fallbackUrl: 'redis://localhost:6379',
    });
    expect(fallbackClient.options.host).toBe('localhost');
    expect(fallbackClient.options.port).toBe(6379);
  });

  it('Provides complete key prefix registry in REDIS_KEY_MAPPING', () => {
    expect(REDIS_KEY_MAPPING['ratelimit']).toBe('state');
    expect(REDIS_KEY_MAPPING['idempotency']).toBe('state');
    expect(REDIS_KEY_MAPPING['auth']).toBe('state');
    expect(REDIS_KEY_MAPPING['remote-config']).toBe('state');
    expect(REDIS_KEY_MAPPING['lookup']).toBe('cache');
    expect(REDIS_KEY_MAPPING['dashboard']).toBe('cache');
    expect(REDIS_KEY_MAPPING['analytics']).toBe('cache');
  });
});

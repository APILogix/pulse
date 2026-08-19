import type { Redis } from 'ioredis';
import type { FastifyBaseLogger } from 'fastify';
import { redis as defaultRedis } from '../../../config/redis.js';
import { logger } from '../../../config/logger.js';
import {
  recordRedisCooldownSuccess,
  recordRedisCooldownRejected,
  recordRedisError,
  recordRedisLatency,
} from './alert-runtime-metrics.js';

export interface CooldownAcquireParams {
  organizationId: string;
  projectId?: string | null;
  ruleId: string;
  fingerprint: string;
  cooldownSeconds: number;
  workerId?: string;
  tier?: string;
}

export interface CooldownAcquireResult {
  acquired: boolean;
  inCooldown: boolean;
  fallback?: boolean;
}

export interface AlertRedisStateOptions {
  redisClient?: Redis;
  logger?: FastifyBaseLogger;
  enabled?: boolean;
}

/**
 * Builds the canonical Redis cooldown key.
 * Format: alert:v1:cooldown:{organizationId}:{projectId}:{ruleId}:{fingerprint}
 */
export function buildCooldownKey(
  organizationId: string,
  projectId: string | null | undefined,
  ruleId: string,
  fingerprint: string,
): string {
  const projectScope = projectId && projectId.trim().length > 0 ? projectId.trim() : 'org';
  return `alert:v1:cooldown:${organizationId}:${projectScope}:${ruleId}:${fingerprint}`;
}

/**
 * Builds the canonical Redis firing gate key.
 * Format: alert:v1:firing:{organizationId}:{projectId}:{ruleId}:{fingerprint}
 */
export function buildFiringGateKey(
  organizationId: string,
  projectId: string | null | undefined,
  ruleId: string,
  fingerprint: string,
): string {
  const projectScope = projectId && projectId.trim().length > 0 ? projectId.trim() : 'org';
  return `alert:v1:firing:${organizationId}:${projectScope}:${ruleId}:${fingerprint}`;
}

export class AlertRedisStateService {
  private readonly redis: Redis;
  private readonly log: FastifyBaseLogger;
  private readonly enabled: boolean;

  constructor(options: AlertRedisStateOptions = {}) {
    this.redis = options.redisClient ?? defaultRedis;
    this.log = (options.logger ?? logger).child({ component: 'alert-redis-state' }) as FastifyBaseLogger;
    this.enabled = options.enabled ?? true;
  }

  /**
   * Atomically acquire cooldown gate for an alert rule occurrence.
   * Uses `SET key payload EX <cooldownSeconds> NX`.
   *
   * If Redis returns 'OK': Gate acquired (not in cooldown).
   * If Redis returns null: Cooldown active (suppress duplicate alert).
   * If Redis is down/errors: Fail-open fallback (acquired: true, fallback: true).
   */
  async acquireCooldown(params: CooldownAcquireParams): Promise<CooldownAcquireResult> {
    if (!this.enabled) {
      return { acquired: true, inCooldown: false, fallback: true };
    }

    const {
      organizationId,
      projectId,
      ruleId,
      fingerprint,
      cooldownSeconds,
      workerId = 'worker',
      tier = 'unknown',
    } = params;

    // Zero or negative cooldown means no cooldown window is enforced
    if (!Number.isFinite(cooldownSeconds) || cooldownSeconds <= 0) {
      recordRedisCooldownSuccess(tier);
      return { acquired: true, inCooldown: false };
    }

    const key = buildCooldownKey(organizationId, projectId, ruleId, fingerprint);
    const ttlSeconds = Math.max(1, Math.floor(cooldownSeconds));
    const payload = JSON.stringify({
      acquiredAt: new Date().toISOString(),
      workerId,
      ruleId,
    });

    const start = performance.now();
    try {
      // Atomic SET NX EX
      const result = await this.redis.set(key, payload, 'EX', ttlSeconds, 'NX');
      const durationMs = performance.now() - start;
      recordRedisLatency('cooldown_acquire', durationMs);

      if (result === 'OK') {
        recordRedisCooldownSuccess(tier);
        this.log.debug(
          { organizationId, projectId: projectId ?? 'org', ruleId, fingerprint, ttlSeconds },
          'Acquired alert cooldown gate in Redis',
        );
        return { acquired: true, inCooldown: false };
      }

      // Redis returned null -> Key already exists, cooldown is active
      recordRedisCooldownRejected(tier);
      this.log.debug(
        { organizationId, projectId: projectId ?? 'org', ruleId, fingerprint },
        'Alert suppressed by active Redis cooldown gate',
      );
      return { acquired: false, inCooldown: true };
    } catch (err) {
      const durationMs = performance.now() - start;
      recordRedisLatency('cooldown_acquire', durationMs);
      recordRedisError('cooldown_acquire');

      this.log.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          organizationId,
          projectId: projectId ?? 'org',
          ruleId,
          fingerprint,
        },
        'Redis cooldown check failed — failing open to database evaluation state',
      );

      // Fail-open fallback: let caller verify via database state so no alert is dropped
      return { acquired: true, inCooldown: false, fallback: true };
    }
  }

  /**
   * Explicitly remove a cooldown gate in Redis (e.g. manual reset, recovery or testing).
   */
  async clearCooldown(
    organizationId: string,
    projectId: string | null | undefined,
    ruleId: string,
    fingerprint: string,
  ): Promise<boolean> {
    const key = buildCooldownKey(organizationId, projectId, ruleId, fingerprint);
    const start = performance.now();
    try {
      const deleted = await this.redis.del(key);
      recordRedisLatency('cooldown_clear', performance.now() - start);
      return deleted > 0;
    } catch (err) {
      recordRedisError('cooldown_clear');
      this.log.warn(
        { err: err instanceof Error ? err.message : String(err), key },
        'Failed to clear alert cooldown in Redis',
      );
      return false;
    }
  }

  /**
   * Check if a cooldown gate is currently active without modifying state.
   */
  async isCooldownActive(
    organizationId: string,
    projectId: string | null | undefined,
    ruleId: string,
    fingerprint: string,
  ): Promise<boolean> {
    const key = buildCooldownKey(organizationId, projectId, ruleId, fingerprint);
    try {
      const exists = await this.redis.exists(key);
      return exists === 1;
    } catch (err) {
      recordRedisError('cooldown_check');
      return false;
    }
  }
}

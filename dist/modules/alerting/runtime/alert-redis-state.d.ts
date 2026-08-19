import type { Redis } from 'ioredis';
import type { FastifyBaseLogger } from 'fastify';
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
export declare function buildCooldownKey(organizationId: string, projectId: string | null | undefined, ruleId: string, fingerprint: string): string;
/**
 * Builds the canonical Redis firing gate key.
 * Format: alert:v1:firing:{organizationId}:{projectId}:{ruleId}:{fingerprint}
 */
export declare function buildFiringGateKey(organizationId: string, projectId: string | null | undefined, ruleId: string, fingerprint: string): string;
export declare class AlertRedisStateService {
    private readonly redis;
    private readonly log;
    private readonly enabled;
    constructor(options?: AlertRedisStateOptions);
    /**
     * Atomically acquire cooldown gate for an alert rule occurrence.
     * Uses `SET key payload EX <cooldownSeconds> NX`.
     *
     * If Redis returns 'OK': Gate acquired (not in cooldown).
     * If Redis returns null: Cooldown active (suppress duplicate alert).
     * If Redis is down/errors: Fail-open fallback (acquired: true, fallback: true).
     */
    acquireCooldown(params: CooldownAcquireParams): Promise<CooldownAcquireResult>;
    /**
     * Explicitly remove a cooldown gate in Redis (e.g. manual reset, recovery or testing).
     */
    clearCooldown(organizationId: string, projectId: string | null | undefined, ruleId: string, fingerprint: string): Promise<boolean>;
    /**
     * Check if a cooldown gate is currently active without modifying state.
     */
    isCooldownActive(organizationId: string, projectId: string | null | undefined, ruleId: string, fingerprint: string): Promise<boolean>;
}
//# sourceMappingURL=alert-redis-state.d.ts.map
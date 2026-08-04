/**
 * Analytics engine Fastify module.
 *
 * Registers the rollup-only read layer under /analytics/v2. This module is
 * READ-ONLY with respect to analytics data: rollups are produced exclusively by
 * the dedicated analytics worker process, so the API can never block on
 * aggregation work (docs/analytics/00-architecture-overview.md §1).
 *
 * The v1 `/analytics/*` module stays registered until the frontend finishes
 * migrating (docs/analytics/14-implementation-roadmap.md Wave 7).
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { AnalyticsReadRepository } from './read/dashboard.repository.js';
import { AnalyticsWatermarkRepository } from './watermark.repository.js';
import { type WindowSize } from './types.js';
/**
 * Per-process response cache.
 *
 * TTL follows the window tier, and cache keys are window-floored, so every API
 * replica computes the same key for the same logical request. No Redis is used
 * (stage constraint in README.md).
 */
export declare class AnalyticsResponseCache {
    private readonly lru;
    constructor(max?: number);
    get(key: string): object | undefined;
    set(key: string, value: object, window: WindowSize): void;
    clear(): void;
    get size(): number;
}
declare module 'fastify' {
    interface FastifyInstance {
        analyticsEngine: {
            read: AnalyticsReadRepository;
            watermarks: AnalyticsWatermarkRepository;
            cache: AnalyticsResponseCache;
            resolveProjectOrg: (projectId: string) => Promise<string | null>;
        };
    }
}
declare function analyticsEngineModule(fastify: FastifyInstance, _options: FastifyPluginOptions): Promise<void>;
export declare const registerAnalyticsEngineModule: typeof analyticsEngineModule;
export default registerAnalyticsEngineModule;
//# sourceMappingURL=analytics-engine.module.d.ts.map
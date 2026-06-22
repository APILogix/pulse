/**
 * Analytics module for Fastify.
 *
 * Flow:
 * 1. Construct repository (with shared pool), cache (with shared Redis), and service.
 * 2. Decorate Fastify with analytics dependencies.
 * 3. Register analytics routes under /analytics.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { AnalyticsCache } from './cache.js';
import { AnalyticsRepository } from './repository.js';
import { AnalyticsService } from './service.js';
declare module 'fastify' {
    interface FastifyInstance {
        analytics: {
            cache: AnalyticsCache;
            repository: AnalyticsRepository;
            service: AnalyticsService;
        };
    }
}
declare function analyticsModule(fastify: FastifyInstance, _options: FastifyPluginOptions): Promise<void>;
export declare const registerAnalyticsModule: typeof analyticsModule;
export default registerAnalyticsModule;
//# sourceMappingURL=analytics.module.d.ts.map
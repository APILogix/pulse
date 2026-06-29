/**
 * Event-analytics module for Fastify.
 *
 * Pulse SDK event analytics over the events_* / analytics_* tables (migration
 * 004). Organization-scoped, read-optimized. No cache, no rate limiting.
 *
 * Distinct from the existing project-scoped `analytics` module (telemetry).
 * Background rollup workers run in the worker process (see workers/main.ts).
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { EventAnalyticsRepository } from './repository.js';
import { EventAnalyticsService } from './service.js';
declare module 'fastify' {
    interface FastifyInstance {
        eventAnalytics: {
            repository: EventAnalyticsRepository;
            service: EventAnalyticsService;
        };
    }
}
declare function eventAnalyticsModule(fastify: FastifyInstance, _options: FastifyPluginOptions): Promise<void>;
export declare const registerEventAnalyticsModule: typeof eventAnalyticsModule;
export default registerEventAnalyticsModule;
//# sourceMappingURL=event-analytics.module.d.ts.map
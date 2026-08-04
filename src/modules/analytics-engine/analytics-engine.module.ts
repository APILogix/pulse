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
import fp from 'fastify-plugin';
import { LRUCache } from 'lru-cache';
import { logDB } from '../../config/log-database.js';
import { pool as controlPlanePool } from '../../config/database.js';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { AnalyticsReadRepository } from './read/dashboard.repository.js';
import { AnalyticsWatermarkRepository } from './watermark.repository.js';
import { analyticsV2Routes } from './api/analytics-v2.routes.js';
import { WINDOW_REFRESH_MS, type WindowSize } from './types.js';

const moduleLogger = logger.child({ component: 'analytics-engine-module' });

/**
 * Per-process response cache.
 *
 * TTL follows the window tier, and cache keys are window-floored, so every API
 * replica computes the same key for the same logical request. No Redis is used
 * (stage constraint in README.md).
 */
export class AnalyticsResponseCache {
  private readonly lru: LRUCache<string, object>;

  constructor(max = 2_000) {
    this.lru = new LRUCache<string, object>({
      max,
      ttl: WINDOW_REFRESH_MS['5m'],
      ttlAutopurge: true,
    });
  }

  get(key: string): object | undefined {
    return this.lru.get(key);
  }

  set(key: string, value: object, window: WindowSize): void {
    this.lru.set(key, value, { ttl: WINDOW_REFRESH_MS[window] });
  }

  clear(): void {
    this.lru.clear();
  }

  get size(): number {
    return this.lru.size;
  }
}

/** projectId → organizationId, cached because project ownership never changes. */
class ProjectOrgResolver {
  private readonly cache = new LRUCache<string, string>({
    max: 50_000,
    ttl: 60_000,
    ttlAutopurge: true,
  });

  async resolve(projectId: string): Promise<string | null> {
    const cached = this.cache.get(projectId);
    if (cached !== undefined) return cached === '' ? null : cached;

    const result = await controlPlanePool.query<{ org_id: string }>(
      'SELECT org_id FROM projects WHERE id = $1 AND deleted_at IS NULL LIMIT 1',
      [projectId],
    );
    const orgId = result.rows[0]?.org_id ?? null;
    this.cache.set(projectId, orgId ?? '');
    return orgId;
  }
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

async function analyticsEngineModule(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
): Promise<void> {
  const pool = logDB.getPrimaryPool();
  const read = new AnalyticsReadRepository(pool);
  const watermarks = new AnalyticsWatermarkRepository(pool);
  const cache = new AnalyticsResponseCache();
  const resolver = new ProjectOrgResolver();

  fastify.decorate('analyticsEngine', {
    read,
    watermarks,
    cache,
    resolveProjectOrg: (projectId: string) => resolver.resolve(projectId),
  });

  await fastify.register(analyticsV2Routes, { prefix: '/analytics/v2' });

  fastify.addHook('onClose', async () => {
    cache.clear();
    moduleLogger.info('Analytics engine module shutting down');
  });

  moduleLogger.info(
    {
      staleThresholdSeconds: env.ANALYTICS_FRESHNESS_STALE_SECONDS,
      engineEnabled: env.ANALYTICS_ENGINE_ENABLED,
    },
    'Analytics engine read API registered at /analytics/v2',
  );
}

export const registerAnalyticsEngineModule = fp(analyticsEngineModule, {
  name: 'analytics-engine-module',
});

export default registerAnalyticsEngineModule;

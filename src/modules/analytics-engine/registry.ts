/**
 * Analytics worker registry — the single declarative source of truth for what
 * the analytics process runs.
 *
 * Spec: docs/analytics/06-worker-architecture.md §2
 *
 * Invariants enforced by test/unit/analytics-engine-registry.test.ts:
 *   - every worker id is unique
 *   - no output table has two owners
 *   - no worker writes a table it also declares as a source
 *   - every worker declares at least one source and one output
 */

import type { Pool } from 'pg';
import { env } from '../../config/env.js';
import { AnalyticsWatermarkRepository } from './watermark.repository.js';
import type { AnalyticsEngineConfig, AnalyticsWorkerSpec } from './types.js';
import { createRequestsWorker } from './workers/requests.worker.js';
import { createEndpointsWorker } from './workers/endpoints.worker.js';
import { createServicesWorker } from './workers/services.worker.js';
import { createErrorsWorker } from './workers/errors.worker.js';
import { createLogsWorker } from './workers/logs.worker.js';
import { createMetricsWorker } from './workers/metrics.worker.js';
import { createRuntimeWorker } from './workers/runtime.worker.js';
import { createSpansWorker } from './workers/spans.worker.js';
import { createTracesWorker } from './workers/traces.worker.js';
import { createCronsWorker } from './workers/crons.worker.js';
import { createGeoWorker } from './workers/geo.worker.js';
import { createSdkWorker } from './workers/sdk.worker.js';
import { createReleasesWorker } from './workers/releases.worker.js';
import { createProfilesWorker, createReplaysWorker } from './workers/profiles.worker.js';
import { createAiWorker } from './workers/ai.worker.js';

/** Engine configuration resolved from validated env. */
export function resolveAnalyticsConfig(): AnalyticsEngineConfig {
  return {
    batchMaxRows: env.ANALYTICS_BATCH_MAX_ROWS,
    maxWindowSpanMinutes: env.ANALYTICS_MAX_WINDOW_SPAN_MINUTES,
    lateEventGraceSeconds: env.ANALYTICS_LATE_EVENT_GRACE_SECONDS,
    statementTimeoutMs: env.ANALYTICS_STATEMENT_TIMEOUT_MS,
    entityTopK: env.ANALYTICS_ENTITY_TOPK,
    apdexThresholdMs: env.ANALYTICS_APDEX_THRESHOLD_MS,
    sessionIdleMinutes: env.ANALYTICS_SESSION_IDLE_MINUTES,
    freshnessStaleSeconds: env.ANALYTICS_FRESHNESS_STALE_SECONDS,
    retentionEnabled: env.ANALYTICS_RETENTION_ENABLED,
  };
}

/**
 * Builds every domain worker. Platform jobs (compaction, retention, partitions,
 * dispatch) are scheduled separately in queue.ts because they are not
 * per-organization and do not own a watermark.
 */
export function buildAnalyticsWorkers(pool: Pool): {
  workers: AnalyticsWorkerSpec[];
  watermarks: AnalyticsWatermarkRepository;
} {
  const watermarks = new AnalyticsWatermarkRepository(pool);

  const workers: AnalyticsWorkerSpec[] = [
    // Live tier — dispatched every 30s.
    createRequestsWorker(watermarks),
    createEndpointsWorker(watermarks),
    createServicesWorker(watermarks),
    createErrorsWorker(watermarks),
    createLogsWorker(watermarks),
    createSpansWorker(watermarks),
    createTracesWorker(watermarks),
    // Standard tier — dispatched every 2 minutes.
    createMetricsWorker(watermarks),
    createRuntimeWorker(watermarks),
    createCronsWorker(watermarks),
    createGeoWorker(watermarks),
    // Slow tier — dispatched every 10 minutes.
    createSdkWorker(watermarks),
    createAiWorker(watermarks),
    createReleasesWorker(watermarks),
    createProfilesWorker(watermarks),
    createReplaysWorker(watermarks),
  ];

  assertRegistryInvariants(workers);
  return { workers, watermarks };
}

export class AnalyticsRegistryError extends Error {}

/**
 * Fails fast on ownership violations. This is what keeps the "exactly one writer
 * per table" rule from docs/analytics/07-rollup-tables.md §4 true over time.
 */
export function assertRegistryInvariants(workers: readonly AnalyticsWorkerSpec[]): void {
  const seenIds = new Set<string>();
  const owners = new Map<string, string>();

  for (const worker of workers) {
    if (seenIds.has(worker.id)) {
      throw new AnalyticsRegistryError(`Duplicate analytics worker id: ${worker.id}`);
    }
    seenIds.add(worker.id);

    if (worker.sourceTables.length === 0) {
      throw new AnalyticsRegistryError(`Worker ${worker.id} declares no source tables`);
    }
    if (worker.outputTables.length === 0) {
      throw new AnalyticsRegistryError(`Worker ${worker.id} declares no output tables`);
    }

    for (const table of worker.outputTables) {
      const existing = owners.get(table);
      if (existing && existing !== worker.id) {
        throw new AnalyticsRegistryError(
          `Rollup table ${table} has two writers: ${existing} and ${worker.id}`,
        );
      }
      owners.set(table, worker.id);

      if (worker.sourceTables.includes(table)) {
        throw new AnalyticsRegistryError(
          `Worker ${worker.id} both reads and writes ${table}; rollup-on-rollup workers must clamp to input watermarks instead`,
        );
      }
    }

    // Analytics workers may only read the Log DB telemetry, runtime tables, or
    // other rollups — never a control-plane table.
    for (const table of worker.sourceTables) {
      if (table.startsWith('pgboss') || table === 'organizations' || table === 'projects') {
        throw new AnalyticsRegistryError(
          `Worker ${worker.id} declares control-plane source ${table}; analytics must read the Log DB only`,
        );
      }
    }
  }
}

/** Table → owning worker map, used by tests and the health endpoint. */
export function rollupOwnership(workers: readonly AnalyticsWorkerSpec[]): Map<string, string> {
  const owners = new Map<string, string>();
  for (const worker of workers) {
    for (const table of worker.outputTables) owners.set(table, worker.id);
  }
  return owners;
}

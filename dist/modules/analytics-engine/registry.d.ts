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
import { AnalyticsWatermarkRepository } from './watermark.repository.js';
import type { AnalyticsEngineConfig, AnalyticsWorkerSpec } from './types.js';
/** Engine configuration resolved from validated env. */
export declare function resolveAnalyticsConfig(): AnalyticsEngineConfig;
/**
 * Builds every domain worker. Platform jobs (compaction, retention, partitions,
 * dispatch) are scheduled separately in queue.ts because they are not
 * per-organization and do not own a watermark.
 */
export declare function buildAnalyticsWorkers(pool: Pool): {
    workers: AnalyticsWorkerSpec[];
    watermarks: AnalyticsWatermarkRepository;
};
export declare class AnalyticsRegistryError extends Error {
}
/**
 * Fails fast on ownership violations. This is what keeps the "exactly one writer
 * per table" rule from docs/analytics/07-rollup-tables.md §4 true over time.
 */
export declare function assertRegistryInvariants(workers: readonly AnalyticsWorkerSpec[]): void;
/** Table → owning worker map, used by tests and the health endpoint. */
export declare function rollupOwnership(workers: readonly AnalyticsWorkerSpec[]): Map<string, string>;
//# sourceMappingURL=registry.d.ts.map
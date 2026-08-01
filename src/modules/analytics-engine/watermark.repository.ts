/**
 * Watermark + run ledger repository.
 *
 * The watermark is the engine's only progress state. It advances in the SAME
 * transaction as the rollup write, so a crash can duplicate work but never skip
 * it (docs/analytics/00-architecture-overview.md §4).
 *
 * Reads and writes here target the Log DB exclusively.
 */

import type { Pool, PoolClient } from 'pg';
import type {
  AnalyticsWorkerId,
  WatermarkRow,
  WindowSize,
  WorkerHealthSnapshot,
  WorkerOutcome,
} from './types.js';

/** How far back a brand-new watermark starts. Bounds first-run cost. */
export const WATERMARK_COLD_START_MINUTES = 60;

/** Failure count at which a worker narrows its window (poison-window guard). */
export const POISON_WINDOW_FAILURE_THRESHOLD = 5;

/** Failure count at which health reporting flips to unhealthy. */
export const UNHEALTHY_FAILURE_THRESHOLD = 3;

interface WatermarkDbRow {
  worker_id: string;
  organization_id: string;
  window_size: string;
  watermark_at: Date;
  last_bucket_at: Date | null;
  last_run_at: Date;
  rows_processed: string | number;
  consecutive_failures: number;
  last_error: string | null;
}

function mapRow(row: WatermarkDbRow): WatermarkRow {
  return {
    workerId: row.worker_id,
    organizationId: row.organization_id,
    windowSize: row.window_size as WindowSize,
    watermarkAt: row.watermark_at,
    lastBucketAt: row.last_bucket_at,
    lastRunAt: row.last_run_at,
    rowsProcessed: Number(row.rows_processed ?? 0),
    consecutiveFailures: row.consecutive_failures,
    lastError: row.last_error,
  };
}

export class AnalyticsWatermarkRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Startup assertion mirroring `AlertRuntimeRepository.assertRuntimePool`:
   * prove this pool is attached to the database that owns the canonical event
   * tables before any worker starts. Audit finding in
   * docs/analytics/03-logdb-audit.md §6 — a worker pointed at the control plane
   * would silently produce empty rollups forever.
   */
  async assertLogDbPool(logger?: { info: (obj: object, msg: string) => void }): Promise<void> {
    const result = await this.pool.query<{ current_database: string; has_events: boolean; has_rollups: boolean }>(
      `SELECT current_database(),
              to_regclass('public.events_requests') IS NOT NULL AS has_events,
              to_regclass('public.request_metrics_1m') IS NOT NULL AS has_rollups`,
    );
    const row = result.rows[0];
    if (!row?.has_events) {
      throw new Error(
        'Analytics engine pool assertion failed: events_requests is not visible from this pool. ' +
          'The analytics workers must be attached to the Log DB (LOG_DB_PRIMARY). ' +
          'Set ANALYTICS_POOL_ASSERT=false only for local bootstrap.',
      );
    }
    if (!row.has_rollups) {
      throw new Error(
        'Analytics engine pool assertion failed: request_metrics_1m is missing. ' +
          'Apply database/migrations/logdb/04_analytics/003_analytics_engine_rollups.up.sql first.',
      );
    }
    logger?.info(
      { database: row.current_database },
      'Analytics engine pool assertion passed (events_* and rollups visible)',
    );
  }

  /**
   * Returns the current watermark, creating a bounded cold-start row when the
   * worker has never run for this organization.
   */
  async acquire(
    workerId: AnalyticsWorkerId,
    organizationId: string,
    windowSize: WindowSize,
    now = new Date(),
  ): Promise<WatermarkRow> {
    const coldStart = new Date(now.getTime() - WATERMARK_COLD_START_MINUTES * 60_000);
    const result = await this.pool.query<WatermarkDbRow>(
      `INSERT INTO analytics_watermarks (worker_id, organization_id, window_size, watermark_at)
            VALUES ($1, $2, $3, $4)
       ON CONFLICT (worker_id, organization_id, window_size) DO UPDATE
             SET last_run_at = NOW()
         RETURNING *`,
      [workerId, organizationId, windowSize, coldStart],
    );
    return mapRow(result.rows[0]!);
  }

  async get(
    workerId: AnalyticsWorkerId,
    organizationId: string,
    windowSize: WindowSize,
  ): Promise<WatermarkRow | null> {
    const result = await this.pool.query<WatermarkDbRow>(
      `SELECT * FROM analytics_watermarks
        WHERE worker_id = $1 AND organization_id = $2 AND window_size = $3`,
      [workerId, organizationId, windowSize],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  /**
   * Advances the watermark inside the caller's transaction. Never moves
   * backwards: `GREATEST` protects against out-of-order job delivery.
   */
  async advance(
    client: PoolClient,
    params: {
      workerId: AnalyticsWorkerId;
      organizationId: string;
      windowSize: WindowSize;
      watermarkAt: Date;
      lastBucketAt?: Date | undefined;
      rowsProcessed: number;
    },
  ): Promise<void> {
    await client.query(
      `UPDATE analytics_watermarks
          SET watermark_at         = GREATEST(watermark_at, $4),
              last_bucket_at       = GREATEST(COALESCE(last_bucket_at, $5), $5),
              rows_processed       = rows_processed + $6,
              consecutive_failures = 0,
              last_error           = NULL,
              last_run_at          = NOW()
        WHERE worker_id = $1 AND organization_id = $2 AND window_size = $3`,
      [
        params.workerId,
        params.organizationId,
        params.windowSize,
        params.watermarkAt,
        params.lastBucketAt ?? null,
        params.rowsProcessed,
      ],
    );
  }

  /**
   * Records a failure without advancing the watermark, so the next run retries
   * the same slice.
   */
  async recordFailure(
    workerId: AnalyticsWorkerId,
    organizationId: string,
    windowSize: WindowSize,
    error: string,
  ): Promise<number> {
    const result = await this.pool.query<{ consecutive_failures: number }>(
      `UPDATE analytics_watermarks
          SET consecutive_failures = consecutive_failures + 1,
              last_error           = LEFT($4, 2000),
              last_run_at          = NOW()
        WHERE worker_id = $1 AND organization_id = $2 AND window_size = $3
        RETURNING consecutive_failures`,
      [workerId, organizationId, windowSize, error],
    );
    return result.rows[0]?.consecutive_failures ?? 0;
  }

  /**
   * Effective catch-up span for a worker: halved (repeatedly, floor 1 minute)
   * once a slice has failed repeatedly, so one poison window cannot stall an
   * organization forever.
   */
  static effectiveSpanMinutes(baseMinutes: number, consecutiveFailures: number): number {
    if (consecutiveFailures < POISON_WINDOW_FAILURE_THRESHOLD) return baseMinutes;
    const halvings = Math.min(6, consecutiveFailures - POISON_WINDOW_FAILURE_THRESHOLD + 1);
    return Math.max(1, Math.floor(baseMinutes / 2 ** halvings));
  }

  async recordRun(params: {
    workerId: AnalyticsWorkerId;
    organizationId: string | null;
    windowSize: WindowSize;
    windowStart: Date | null;
    windowEnd: Date | null;
    rowsRead: number;
    rowsWritten: number;
    durationMs: number;
    outcome: WorkerOutcome;
    errorMessage?: string | undefined;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO analytics_worker_runs
         (worker_id, organization_id, window_size, window_start, window_end,
          rows_read, rows_written, duration_ms, outcome, error_message, finished_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,LEFT($10, 2000),NOW())`,
      [
        params.workerId,
        params.organizationId,
        params.windowSize,
        params.windowStart,
        params.windowEnd,
        params.rowsRead,
        params.rowsWritten,
        params.durationMs,
        params.outcome,
        params.errorMessage ?? null,
      ],
    );
  }

  /** Per-worker health for the process health endpoint. */
  async healthSnapshot(now = new Date()): Promise<WorkerHealthSnapshot[]> {
    const result = await this.pool.query<{
      worker_id: string;
      watermark_at: Date;
      consecutive_failures: number;
      last_run_at: Date;
      rows_processed: string | number;
    }>(
      `SELECT worker_id,
              MIN(watermark_at)              AS watermark_at,
              MAX(consecutive_failures)      AS consecutive_failures,
              MAX(last_run_at)               AS last_run_at,
              SUM(rows_processed)            AS rows_processed
         FROM analytics_watermarks
        GROUP BY worker_id
        ORDER BY worker_id`,
    );

    return result.rows.map((row) => {
      const lagSeconds = Math.max(
        0,
        Math.round((now.getTime() - new Date(row.watermark_at).getTime()) / 1_000),
      );
      const failures = Number(row.consecutive_failures ?? 0);
      let status: WorkerHealthSnapshot['status'] = 'healthy';
      if (failures >= UNHEALTHY_FAILURE_THRESHOLD) status = 'unhealthy';
      else if (failures > 0) status = 'degraded';

      return {
        id: row.worker_id,
        lagSeconds,
        consecutiveFailures: failures,
        lastRunAt: row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
        rowsProcessedLastRun: Number(row.rows_processed ?? 0),
        status,
      };
    });
  }

  /**
   * Freshness for the API: the oldest watermark across the workers that feed a
   * response. Returns null when nothing has been materialised yet.
   */
  async freshnessFor(workerIds: readonly string[], organizationId: string): Promise<Date | null> {
    if (workerIds.length === 0) return null;
    const result = await this.pool.query<{ watermark_at: Date | null }>(
      `SELECT MIN(watermark_at) AS watermark_at
         FROM analytics_watermarks
        WHERE organization_id = $1 AND worker_id = ANY($2::text[])`,
      [organizationId, [...workerIds]],
    );
    return result.rows[0]?.watermark_at ?? null;
  }

  /** Organizations the engine is already tracking. */
  async trackedOrganizations(): Promise<string[]> {
    const result = await this.pool.query<{ organization_id: string }>(
      `SELECT DISTINCT organization_id FROM analytics_watermarks`,
    );
    return result.rows.map((row) => row.organization_id);
  }

  /** Prunes the run ledger. Retention is fixed at 14 days by design. */
  async pruneRuns(retentionDays = 14): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM analytics_worker_runs WHERE started_at < NOW() - ($1 || ' days')::interval`,
      [String(retentionDays)],
    );
    return result.rowCount ?? 0;
  }
}

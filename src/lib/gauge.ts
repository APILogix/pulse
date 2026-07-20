import { logger } from '../config/logger.js';

const gaugeLogger = logger.child({ component: 'backpressure-gauge' });

export interface GaugeState {
  pendingDepth: number;
  updatedAt: Date;
  lastWorkerId?: string | null;
}

type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

/**
 * Cross-process backpressure gauge.
 *
 * After the pg-boss cutover there is no writer-side singleton row: the gauge
 * reads the pg-boss job table directly (pending = created + retry across the
 * ingest.<type> queues), so every API process sees the same live depth. Reads
 * fail open (return null) so readiness policy decides how to react.
 */
export class BackpressureGauge {
  constructor(private readonly db: Queryable) {}

  async read(): Promise<GaugeState | null> {
    try {
      const result = await this.db.query(
        `SELECT COUNT(*)::bigint AS pending_depth
         FROM pgboss.job
         WHERE name LIKE 'ingest.%' AND state IN ('created', 'retry')`,
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        pendingDepth: Number(row.pending_depth ?? 0),
        // Fresh on every read, so callers' staleness checks always pass.
        updatedAt: new Date(),
        lastWorkerId: null,
      };
    } catch (err) {
      // pgboss schema not yet created (first boot) or transient error.
      gaugeLogger.error({ err }, 'Failed to read backpressure gauge');
      return null;
    }
  }

  /**
   * @deprecated No-op since the pg-boss cutover — depth is read live from
   * pgboss.job; nothing needs to write the gauge. Retained so legacy callers
   * still compile.
   */
  async update(_depth: number, _workerId: string): Promise<void> {
    // intentionally a no-op
  }

  isStale(state: GaugeState, maxAgeMs: number): boolean {
    return Date.now() - state.updatedAt.getTime() > maxAgeMs;
  }
}

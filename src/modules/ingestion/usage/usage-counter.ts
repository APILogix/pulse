/**
 * UsageCounter â€” ultra-low-latency, three-tier usage accounting.
 *
 * The ingestion hot path must NEVER block on a usage write. Counting every
 * accepted/persisted event with a synchronous DB UPDATE would serialize the
 * pipeline on a single hot row per project. Instead we use three tiers:
 *
 *   Tier 1  In-memory Map<string, number> per worker process.
 *           increment() only touches memory â€” O(1), allocation-free on the hot
 *           path, never awaits. This is where the ingestion pipeline calls in.
 *
 *   Tier 2  usage_counter_staging â€” an UNLOGGED Postgres table (no WAL). On a
 *           timer (or when the buffer is large) we drain the memory map into a
 *           single multi-row INSERT. UNLOGGED keeps these writes cheap; the
 *           trade-off is they are lost on an unclean crash, which is acceptable
 *           for approximate usage pre-aggregation.
 *
 *   Tier 3  project_usage â€” durable, hourly-bucketed rollups. The SQL function
 *           flush_usage_counters() aggregates settled staging rows into hourly
 *           buckets and UPSERTs them, then deletes the consumed rows.
 *
 * Reads go through the project_usage_realtime view, which sums the durable
 * buckets plus the un-flushed staging tail so a read never misses the last few
 * seconds of activity.
 *
 * Delivery semantics: at-least-once aggregation with bounded loss only on an
 * unclean process crash before the next 30s flush (tier-1 memory). The durable
 * telemetry rows themselves are never affected â€” this is a side-channel counter.
 *
 * Migration: migrations2/010_ingestion_create_usage_counters_schema.up.sql.
 */
import type { Pool } from 'pg';
import type { Logger } from 'pino';

/** Common counter types. Free-form strings are allowed; these are the canon. */
export type CounterType =
  | 'events_ingested'
  | 'events_accepted'
  | 'events_rejected'
  | 'events_shed'
  | 'bytes_ingested'
  | string;

export interface UsageCounterOptions {
  /** Auto-flush cadence in milliseconds. Default 30s. */
  flushIntervalMs?: number;
  /** Force a flush when the in-memory buffer reaches this many keys. Default 10k. */
  bufferLimit?: number;
  /**
   * Whether this instance drives the staging->durable rollup
   * (flush_usage_counters()). Default true. Set false in the API cluster
   * (many processes) so only the worker tier runs the aggregation, while API
   * processes still drain their Tier-1 memory into the UNLOGGED staging table.
   */
  driveRollup?: boolean;
}

interface BufferEntry {
  projectId: string;
  orgId: string;
  counterType: string;
  value: number;
}

export class UsageCounter {
  private buffer = new Map<string, BufferEntry>();
  private readonly flushIntervalMs: number;
  private readonly bufferLimit: number;
  private readonly driveRollup: boolean;
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private stopped = false;

  constructor(
    private readonly pool: Pool,
    private readonly log: Logger,
    opts: UsageCounterOptions = {},
  ) {
    this.flushIntervalMs = opts.flushIntervalMs ?? 30_000;
    this.bufferLimit = opts.bufferLimit ?? 10_000;
    this.driveRollup = opts.driveRollup ?? true;
  }

  /** Start the periodic flush timer. Safe to call once. */
  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
    // Don't keep the process alive solely for the counter flush.
    this.timer.unref?.();
    this.log.info({ flushIntervalMs: this.flushIntervalMs }, 'UsageCounter started');
  }

  /**
   * Tier-1 increment. Fire-and-forget: updates memory only, never awaits, never
   * throws. When the buffer crosses the limit we kick off an async flush but do
   * NOT block the caller on it.
   */
  increment(projectId: string, orgId: string, counterType: CounterType, by = 1): void {
    if (this.stopped) return;
    if (!projectId || !orgId || !counterType || by <= 0) return;
    const key = `${projectId}\u0000${orgId}\u0000${counterType}`;
    const existing = this.buffer.get(key);
    if (existing) {
      existing.value += by;
    } else {
      this.buffer.set(key, { projectId, orgId, counterType, value: by });
    }
    if (this.buffer.size >= this.bufferLimit) {
      void this.flush();
    }
  }

  /**
   * Tier-1 -> Tier-2 -> Tier-3 flush. Drains the in-memory map into a single
   * multi-row INSERT against the UNLOGGED staging table, then asks Postgres to
   * roll settled staging rows up into the durable hourly buckets.
   *
   * Re-entrancy guarded: only one flush runs at a time. On insert failure the
   * drained counts are merged back into the buffer so nothing is lost between
   * flush attempts.
   */
  async flush(): Promise<void> {
    if (this.flushing) return;
    if (this.buffer.size === 0) {
      // Still drive the rollup so staging never accumulates if increments
      // happened in another process.
      await this.runRollup();
      return;
    }
    this.flushing = true;

    // Atomically swap out the current buffer so concurrent increments land in a
    // fresh map and are not lost mid-flush.
    const draining = this.buffer;
    this.buffer = new Map<string, BufferEntry>();

    try {
      const entries = [...draining.values()];
      const tuples: string[] = [];
      const params: unknown[] = [];
      let p = 1;
      for (const e of entries) {
        tuples.push(`($${p++}, $${p++}, $${p++}, $${p++})`);
        params.push(e.projectId, e.orgId, e.counterType, e.value);
      }
      await this.pool.query(
        `INSERT INTO usage_counter_staging (project_id, org_id, counter_type, increment_by)
         VALUES ${tuples.join(', ')}`,
        params,
      );
    } catch (err) {
      // Merge the un-inserted counts back so the next flush retries them.
      for (const [key, e] of draining) {
        const cur = this.buffer.get(key);
        if (cur) cur.value += e.value;
        else this.buffer.set(key, e);
      }
      this.log.warn({ err }, 'UsageCounter staging flush failed; counts re-buffered');
    } finally {
      this.flushing = false;
    }

    await this.runRollup();
  }

  /** Drive flush_usage_counters() until it stops returning work (bounded). */
  private async runRollup(): Promise<void> {
    if (!this.driveRollup) return;
    try {
      // The SQL function consumes up to 10k staging rows per call. Loop a
      // bounded number of times so a backlog drains without an unbounded loop.
      for (let i = 0; i < 20; i++) {
        const r = await this.pool.query<{ flushed_count: string }>(
          `SELECT flushed_count FROM flush_usage_counters()`,
        );
        if (r.rowCount === 0) break;
      }
    } catch (err) {
      this.log.warn({ err }, 'UsageCounter rollup (flush_usage_counters) failed');
    }
  }

  /**
   * Read current usage for a project/counter. Uses the realtime view so the
   * un-flushed staging tail is included. When periodStart is omitted, sums all
   * buckets for the counter.
   */
  async getUsage(
    projectId: string,
    counterType: CounterType,
    periodStart?: Date,
  ): Promise<number> {
    if (periodStart) {
      const r = await this.pool.query<{ total_value: string }>(
        `SELECT COALESCE(SUM(total_value), 0)::text AS total_value
         FROM project_usage_realtime
         WHERE project_id = $1 AND counter_type = $2 AND period_start = $3`,
        [projectId, counterType, periodStart.toISOString()],
      );
      return Number(r.rows[0]?.total_value ?? 0);
    }
    const r = await this.pool.query<{ total_value: string }>(
      `SELECT COALESCE(SUM(total_value), 0)::text AS total_value
       FROM project_usage_realtime
       WHERE project_id = $1 AND counter_type = $2`,
      [projectId, counterType],
    );
    return Number(r.rows[0]?.total_value ?? 0);
  }

  /** Final flush + stop the timer. Call on graceful shutdown. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
    this.log.info('UsageCounter stopped (final flush complete)');
  }
}


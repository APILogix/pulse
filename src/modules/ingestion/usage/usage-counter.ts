import type { Pool, QueryResult, QueryResultRow } from 'pg';
import type { Logger } from 'pino';
import { isExpectedServerlessDisconnect, isTransientPostgresError } from '../../../config/postgres-ssl.js';

export type CounterType = 'events' | 'requests' | 'errors' | 'bytes_ingested' | 'rate_limited' | string;

export interface UsageDimensions {
  apiKeyId?: string | null;
  eventType?: string | null;
}

export interface UsageCounterOptions {
  flushIntervalMs?: number;
  bufferLimit?: number;
  driveRollup?: boolean;
}

interface BufferEntry {
  projectId: string;
  orgId: string;
  counterType: string;
  value: number;
  apiKeyId: string | null;
  eventType: string;
}

const REALTIME_COLUMNS: Record<string, string> = {
  events: 'total_events',
  total_events: 'total_events',
  events_ingested: 'total_events',
  events_persisted: 'total_events',
  requests: 'requests',
  events_received: 'requests',
  errors: 'errors',
  events_rejected: 'errors',
  bytes_ingested: 'total_bytes',
  rate_limited: 'rate_limit_usage',
  events_shed: 'rate_limit_usage',
};

export class UsageCounter {
  private buffer = new Map<string, BufferEntry>();
  private readonly flushIntervalMs: number;
  private readonly bufferLimit: number;
  private readonly driveRollup: boolean;
  private timer: NodeJS.Timeout | null = null;
  private flushPromise: Promise<void> | null = null;
  private flushRequested = false;
  private stopped = false;
  private schemaReady: Promise<void> | null = null;

  // Hard bound to guarantee memory cannot grow without limit under sustained sink failure
  private static readonly MAX_BUFFER_HARD_LIMIT = 20_000;

  constructor(private readonly pool: Pool, private readonly log: Logger, opts: UsageCounterOptions = {}) {
    this.flushIntervalMs = opts.flushIntervalMs ?? 30_000;
    this.bufferLimit = opts.bufferLimit ?? 10_000;
    this.driveRollup = opts.driveRollup ?? true;
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => {
      void this.flush().catch(() => undefined);
    }, this.flushIntervalMs);
    this.timer.unref?.();
    this.log.info({ flushIntervalMs: this.flushIntervalMs }, 'UsageCounter started');
  }

  increment(
    projectId: string,
    orgId: string,
    counterType: CounterType,
    by = 1,
    dimensions: UsageDimensions = {},
  ): void {
    if (this.stopped || !projectId || !orgId || !counterType || by <= 0) return;
    const apiKeyId = dimensions.apiKeyId ?? null;
    const eventType = dimensions.eventType?.trim() || 'all';
    const key = [projectId, orgId, counterType, apiKeyId ?? '', eventType].join('\u0000');
    const existing = this.buffer.get(key);
    if (existing) {
      existing.value = Math.round((existing.value + by) * 10000) / 10000;
    } else {
      if (this.buffer.size >= UsageCounter.MAX_BUFFER_HARD_LIMIT) {
        const oldestKey = this.buffer.keys().next().value;
        if (oldestKey !== undefined) {
          this.buffer.delete(oldestKey);
        }
        this.log.warn(
          { bufferSize: this.buffer.size, hardLimit: UsageCounter.MAX_BUFFER_HARD_LIMIT },
          'UsageCounter buffer reached hard cap; evicted oldest entry to bound memory',
        );
      }
      this.buffer.set(key, { projectId, orgId, counterType, value: Math.round(by * 10000) / 10000, apiKeyId, eventType });
    }
    if (this.buffer.size >= this.bufferLimit) {
      void this.flush().catch(() => undefined);
    }
  }

  flush(): Promise<void> {
    if (this.flushPromise) {
      // A threshold/timer/stop request that arrives during a flush means data
      // may have accumulated in the replacement buffer. The owner loops once
      // more before resolving, so callers never mistake the first snapshot for
      // a complete drain.
      this.flushRequested = true;
      return this.flushPromise;
    }

    this.flushRequested = false;
    const run = (async () => {
      do {
        this.flushRequested = false;
        await this.flushOnce();
      } while (this.flushRequested && this.buffer.size > 0);
    })();
    const tracked = run.finally(() => {
      if (this.flushPromise === tracked) this.flushPromise = null;
    });
    this.flushPromise = tracked;
    return tracked;
  }

  private async executeWithRetry<R extends QueryResultRow = any>(
    sql: string,
    params?: unknown[],
    maxRetries = 2,
  ): Promise<QueryResult<R>> {
    let attempt = 0;
    while (true) {
      try {
        return await this.pool.query<R>(sql, params);
      } catch (err: unknown) {
        attempt++;
        if (attempt <= maxRetries && isTransientPostgresError(err)) {
          const delayMs = Math.min(2000, 150 * 2 ** (attempt - 1));
          this.log.debug(
            { attempt, maxRetries, delayMs, err: err instanceof Error ? err.message : String(err) },
            'Transient database error in UsageCounter query; retrying...',
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw err;
      }
    }
  }

  private async flushOnce(): Promise<void> {
    if (this.buffer.size === 0) {
      await this.runRollup();
      return;
    }

    // This await is inside the authoritative flushPromise. A concurrent caller
    // therefore joins this work instead of starting a second schema/flush path.
    try {
      await this.ensureSchema();
    } catch (err) {
      this.log.warn(
        { err, bufferedEntries: this.buffer.size, bufferLimit: this.bufferLimit },
        'UsageCounter schema check failed; counts remain buffered',
      );
      throw err;
    }

    const draining = this.buffer;
    this.buffer = new Map<string, BufferEntry>();
    try {
      const tuples: string[] = [];
      const params: unknown[] = [];
      let parameter = 1;
      for (const entry of draining.values()) {
        tuples.push(`($${parameter++}, $${parameter++}, $${parameter++}, $${parameter++}, $${parameter++}, $${parameter++})`);
        params.push(
          entry.projectId,
          entry.orgId,
          entry.apiKeyId,
          entry.eventType,
          entry.counterType,
          entry.value,
        );
      }
      await this.executeWithRetry(
        `INSERT INTO usage_counter_staging (
           project_id, org_id, api_key_id, event_type, counter_type, increment_by
         ) VALUES ${tuples.join(', ')}`,
        params,
      );
    } catch (err) {
      for (const [key, entry] of draining) {
        if (this.buffer.size >= UsageCounter.MAX_BUFFER_HARD_LIMIT && !this.buffer.has(key)) {
          continue; // Respect hard cap on re-buffering
        }
        const current = this.buffer.get(key);
        if (current) current.value += entry.value;
        else this.buffer.set(key, entry);
      }
      const bufferedEntries = this.buffer.size;
      const isExpected = isExpectedServerlessDisconnect(err);
      this.log[isExpected ? 'debug' : 'warn'](
        {
          err,
          bufferedEntries,
          bufferLimit: this.bufferLimit,
          overLimitBy: Math.max(0, bufferedEntries - this.bufferLimit),
        },
        'UsageCounter staging flush failed; counts re-buffered',
      );
      // The rejection is intentional: stop() can retry once and, if the final
      // drain still fails, propagate failure instead of claiming a clean drain.
      throw err;
    }

    await this.runRollup();
  }

  private async ensureSchema(): Promise<void> {
    this.schemaReady ??= this.executeWithRetry(`
      CREATE UNLOGGED TABLE IF NOT EXISTS usage_counter_staging (
        id BIGSERIAL PRIMARY KEY,
        project_id UUID NOT NULL,
        org_id UUID NOT NULL,
        api_key_id UUID,
        event_type TEXT NOT NULL DEFAULT 'all',
        counter_type VARCHAR(64) NOT NULL,
        increment_by NUMERIC(14, 4) NOT NULL DEFAULT 1 CHECK (increment_by > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE usage_counter_staging
        ADD COLUMN IF NOT EXISTS api_key_id UUID,
        ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'all';

      CREATE INDEX IF NOT EXISTS idx_usage_staging_project
        ON usage_counter_staging(project_id, counter_type, created_at);
      CREATE INDEX IF NOT EXISTS idx_usage_staging_flush
        ON usage_counter_staging(created_at);
      CREATE INDEX IF NOT EXISTS idx_usage_staging_api_key
        ON usage_counter_staging(api_key_id, event_type, created_at)
        WHERE api_key_id IS NOT NULL;
    `).then(() => undefined);
    try {
      await this.schemaReady;
    } catch (err) {
      this.schemaReady = null;
      throw err;
    }
  }

  private async runRollup(): Promise<void> {
    if (!this.driveRollup) return;
    try {
      for (let i = 0; i < 20; i++) {
        const result = await this.executeWithRetry<{ flushed_count: string }>(
          'SELECT flushed_count FROM flush_usage_counters()',
        );
        if (result.rowCount === 0) break;
      }
    } catch (err) {
      this.log.warn({ err }, 'UsageCounter rollup (flush_usage_counters) failed');
    }
  }

  async getUsage(projectId: string, counterType: CounterType, periodStart?: Date): Promise<number> {
    const column = REALTIME_COLUMNS[counterType];
    if (!column) return 0;
    const params: unknown[] = [projectId];
    const bucketClause = periodStart ? ' AND bucket = $2' : '';
    if (periodStart) params.push(periodStart);
    const result = await this.executeWithRetry<{ total_value: string }>(
      `SELECT COALESCE(SUM(${column}), 0)::text AS total_value
         FROM project_usage_realtime
        WHERE project_id = $1${bucketClause}`,
      params,
    );
    return Number(result.rows[0]?.total_value ?? 0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // Join work already in flight. If it failed, flushOnce re-buffered every
    // count; the final flush below is then a clean retry after the tracked
    // promise has cleared.
    if (this.flushPromise) {
      this.flushRequested = true;
      await this.flushPromise.catch(() => undefined);
    }
    await this.flush();
    this.log.info('UsageCounter stopped (final flush complete)');
  }
}

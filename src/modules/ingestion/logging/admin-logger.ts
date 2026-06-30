/**
 * AdminLogger — buffered, dual-sink structured logger for the ingestion worker
 * tier's administrative/operational events.
 *
 * Two sinks, written together on flush:
 *   1. ingestion_admin_logs   (PRIMARY Postgres, partitioned)  — for IMMEDIATE
 *      operator queries from the dashboard / API.
 *   2. admin_audit_log        (TimescaleDB hypertable)         — for long-term
 *      historical analytics + retention policy. Skipped when LogDatabase is
 *      disabled (TIMESCALEDB_URL unset).
 *
 * Buffering: entries accumulate in memory and flush every `flushIntervalMs`
 * (default 5s) or when the buffer reaches `bufferSize` (default 100). This
 * keeps high-frequency operational logging off the synchronous hot path while
 * bounding loss to a single flush window on crash.
 *
 * Never throws on the logging path — a logging failure must not break
 * ingestion. Failed flushes re-buffer (bounded) and retry on the next cycle.
 */
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { LogDatabase, AdminAuditRecord } from './log-database.js';

export type AdminLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface AdminLogContext {
  orgId?: string | null;
  projectId?: string | null;
  jobId?: string | null;
  eventId?: string | null;
  workerId?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface AdminLogEntry extends AdminLogContext {
  logLevel: AdminLogLevel;
  category: string;
  message: string;
  createdAt: Date;
}

export interface AdminLoggerOptions {
  bufferSize?: number;
  flushIntervalMs?: number;
}

export class AdminLogger {
  private buffer: AdminLogEntry[] = [];
  private readonly bufferSize: number;
  private readonly flushIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private stopped = false;

  // Hard cap so a sustained DB outage can never grow the buffer unbounded.
  private static readonly MAX_BUFFER = 10_000;

  constructor(
    private readonly pool: Pool,
    private readonly logDb: LogDatabase,
    private readonly log: Logger,
    opts: AdminLoggerOptions = {},
  ) {
    this.bufferSize = opts.bufferSize ?? 100;
    this.flushIntervalMs = opts.flushIntervalMs ?? 5_000;
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
    this.timer.unref?.();
  }

  debug(category: string, message: string, ctx?: AdminLogContext): void {
    this.enqueue('debug', category, message, ctx);
  }
  info(category: string, message: string, ctx?: AdminLogContext): void {
    this.enqueue('info', category, message, ctx);
  }
  warn(category: string, message: string, ctx?: AdminLogContext): void {
    this.enqueue('warn', category, message, ctx);
  }
  error(category: string, message: string, ctx?: AdminLogContext): void {
    this.enqueue('error', category, message, ctx);
  }
  fatal(category: string, message: string, ctx?: AdminLogContext): void {
    this.enqueue('fatal', category, message, ctx);
    // Fatal events are flushed immediately — we may be about to crash.
    void this.flush();
  }

  private enqueue(
    logLevel: AdminLogLevel,
    category: string,
    message: string,
    ctx?: AdminLogContext,
  ): void {
    if (this.stopped) return;
    if (this.buffer.length >= AdminLogger.MAX_BUFFER) {
      // Drop oldest to bound memory under a persistent sink outage.
      this.buffer.shift();
    }
    this.buffer.push({
      logLevel,
      category: category.slice(0, 64),
      message: message.slice(0, 8192),
      orgId: ctx?.orgId ?? null,
      projectId: ctx?.projectId ?? null,
      jobId: ctx?.jobId ?? null,
      eventId: ctx?.eventId ?? null,
      workerId: ctx?.workerId ?? null,
      metadata: ctx?.metadata ?? null,
      createdAt: new Date(),
    });
    if (this.buffer.length >= this.bufferSize) {
      void this.flush();
    }
  }

  /** Drain the buffer to both sinks. Re-entrancy guarded; never throws. */
  async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;
    const batch = this.buffer;
    this.buffer = [];

    try {
      await this.writePrimary(batch);
      await this.logDb.writeAdminAudit(batch.map(toAuditRecord));
    } catch (err) {
      // Re-buffer (bounded) so the next cycle retries.
      this.buffer = batch.concat(this.buffer).slice(-AdminLogger.MAX_BUFFER);
      this.log.warn({ err }, 'AdminLogger flush failed; entries re-buffered');
    } finally {
      this.flushing = false;
    }
  }

  private async writePrimary(batch: AdminLogEntry[]): Promise<void> {
    const tuples: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    for (const e of batch) {
      tuples.push(
        `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}::jsonb, $${p++})`,
      );
      params.push(
        e.logLevel,
        e.category,
        e.message,
        e.orgId,
        e.projectId,
        e.jobId,
        e.eventId,
        e.workerId,
        e.metadata ? JSON.stringify(e.metadata) : null,
        e.createdAt.toISOString(),
      );
    }
    await this.pool.query(
      `INSERT INTO ingestion_admin_logs
         (log_level, category, message, org_id, project_id, job_id, event_id, worker_id, metadata, created_at)
       VALUES ${tuples.join(', ')}`,
      params,
    );
  }

  /** Final flush + stop the timer. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}

function toAuditRecord(e: AdminLogEntry): AdminAuditRecord {
  return {
    logLevel: e.logLevel,
    category: e.category,
    message: e.message,
    orgId: e.orgId ?? null,
    projectId: e.projectId ?? null,
    jobId: e.jobId ?? null,
    eventId: e.eventId ?? null,
    workerId: e.workerId ?? null,
    metadata: e.metadata ?? null,
    createdAt: e.createdAt,
  };
}

import { Queue, Job } from 'bullmq';
import type { EnrichedEvent } from './types.js';

export interface BufferMetrics {
  pending: number;
  flushedTotal: number;
  lastFlushAt: number | null;
}

/**
 * In-memory buffer with backpressure handling.
 * Accumulates events before bulk-pushing to BullMQ.
 */
export class IngestionBuffer {
  private buffer: EnrichedEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private flushedTotal = 0;
  private lastFlushAt: number | null = null;
  private readonly maxSize: number;
  private readonly flushIntervalMs: number;
  private readonly maxRetries: number;

  constructor(
    private queue: Queue,
    options: { 
      maxSize?: number; 
      flushIntervalMs?: number;
      maxRetries?: number;
    } = {}
  ) {
    this.maxSize = options.maxSize || 100;
    this.flushIntervalMs = options.flushIntervalMs || 50;
    this.maxRetries = options.maxRetries || 3;
  }

  async add(event: EnrichedEvent): Promise<void> {
    this.buffer.push(event);

    if (this.buffer.length >= this.maxSize) {
      await this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.flushIntervalMs);
    }
  }

  async flush(): Promise<void> {
    if (this.isFlushing || this.buffer.length === 0) return;

    this.isFlushing = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const batch = this.buffer.splice(0, this.buffer.length);

    try {
      await this.pushToQueue(batch);
      this.flushedTotal += batch.length;
      this.lastFlushAt = Date.now();
    } catch (err) {
      // Critical: if flush fails, push back to buffer to prevent data loss
      this.buffer.unshift(...batch);
      
      // If buffer grows too large, drop oldest (backpressure)
      if (this.buffer.length > this.maxSize * 10) {
        const dropped = this.buffer.splice(0, this.buffer.length - this.maxSize * 10);
        console.error(`[Buffer] Dropped ${dropped.length} events due to backpressure`);
      }
      
      throw err;
    } finally {
      this.isFlushing = false;
    }
  }

  private async pushToQueue(events: EnrichedEvent[]): Promise<void> {
    const jobs = events.map((event) => ({
      name: event.type,
      data: event,
      opts: {
        jobId: event.id, // Idempotency at queue level
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 5000, age: 3600 },
        removeOnFail: { count: 10000, age: 86400 * 7 }, // 7 days for DLQ
      },
    }));

    await this.queue.addBulk(jobs);
  }

  async destroy(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    
    // Retry flush up to maxRetries
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        await this.flush();
        break;
      } catch (err) {
        if (i === this.maxRetries - 1) {
          console.error(`[Buffer] Failed to flush after ${this.maxRetries} attempts. ${this.buffer.length} events lost.`);
          throw err;
        }
        await new Promise(r => setTimeout(r, 100 * Math.pow(2, i)));
      }
    }
  }

  get metrics(): BufferMetrics {
    return {
      pending: this.buffer.length,
      flushedTotal: this.flushedTotal,
      lastFlushAt: this.lastFlushAt,
    };
  }
}
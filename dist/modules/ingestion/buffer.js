/**
 * Ingestion buffer.
 *
 * Flow:
 * 1. Events are accepted into memory immediately to keep SDK ingestion latency
 *    low.
 * 2. The buffer flushes either when it reaches maxSize or when the short timer
 *    expires.
 * 3. Flushes create BullMQ jobs in bulk with event ids as job ids, giving the
 *    queue another idempotency layer.
 * 4. If BullMQ rejects a flush, events are pushed back into memory and bounded
 *    backpressure prevents unbounded process growth.
 */
import { Queue, Job } from 'bullmq';
/**
 * In-memory buffer with backpressure handling.
 * Accumulates events before bulk-pushing to BullMQ.
 */
export class IngestionBuffer {
    queue;
    buffer = [];
    flushTimer = null;
    isFlushing = false;
    flushedTotal = 0;
    lastFlushAt = null;
    maxSize;
    flushIntervalMs;
    maxRetries;
    constructor(queue, options = {}) {
        this.queue = queue;
        this.maxSize = options.maxSize || 100;
        this.flushIntervalMs = options.flushIntervalMs || 50;
        this.maxRetries = options.maxRetries || 3;
    }
    async add(event) {
        // A full buffer flushes synchronously; otherwise a timer gives nearby events
        // a chance to coalesce into one BullMQ addBulk call.
        this.buffer.push(event);
        if (this.buffer.length >= this.maxSize) {
            await this.flush();
        }
        else if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => this.flush(), this.flushIntervalMs);
        }
    }
    async flush() {
        // Only one flush may own the buffer at a time. This avoids duplicate jobs
        // and preserves the retry path when addBulk fails.
        if (this.isFlushing || this.buffer.length === 0)
            return;
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
        }
        catch (err) {
            // Critical: if flush fails, push back to buffer to prevent data loss
            this.buffer.unshift(...batch);
            // If buffer grows too large, drop oldest (backpressure)
            if (this.buffer.length > this.maxSize * 10) {
                const dropped = this.buffer.splice(0, this.buffer.length - this.maxSize * 10);
                console.error(`[Buffer] Dropped ${dropped.length} events due to backpressure`);
            }
            throw err;
        }
        finally {
            this.isFlushing = false;
        }
    }
    async pushToQueue(events) {
        // BullMQ handles worker retries, exponential backoff, and failed-job
        // retention. The jobId is the event id so repeated flush attempts stay
        // idempotent at the queue layer.
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
    async destroy() {
        // Shutdown must drain the timer and try a bounded final flush so accepted
        // API events are not silently abandoned during process termination.
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        // Retry flush up to maxRetries
        for (let i = 0; i < this.maxRetries; i++) {
            try {
                await this.flush();
                break;
            }
            catch (err) {
                if (i === this.maxRetries - 1) {
                    console.error(`[Buffer] Failed to flush after ${this.maxRetries} attempts. ${this.buffer.length} events lost.`);
                    throw err;
                }
                await new Promise(r => setTimeout(r, 100 * Math.pow(2, i)));
            }
        }
    }
    get metrics() {
        return {
            pending: this.buffer.length,
            flushedTotal: this.flushedTotal,
            lastFlushAt: this.lastFlushAt,
        };
    }
}
//# sourceMappingURL=buffer.js.map
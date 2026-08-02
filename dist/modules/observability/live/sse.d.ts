/**
 * SSE live stream (Phase 13). A bounded poll loop tails new telemetry and
 * pushes it over Server-Sent Events. No polling on the client, no Redis
 * pub/sub: the server advances a time cursor and emits only new rows, with
 * heartbeats and clean teardown on disconnect. Pause/resume/auto-scroll/buffer
 * are client concerns; the server guarantees at-least-once forward delivery.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
export interface StreamOptions {
    /** Poll cadence in milliseconds. */
    intervalMs: number;
    /** Fetch rows newer than the cursor (ascending). */
    fetchSince: (since: Date) => Promise<Array<Record<string, unknown>>>;
    /** Row field carrying the event time used to advance the cursor. */
    timeField?: string;
    /** Max heartbeat gap in milliseconds. */
    heartbeatMs?: number;
}
/**
 * Run an SSE loop until the client disconnects. Errors in a single poll are
 * logged and swallowed so a transient DB blip does not kill the stream.
 */
export declare function streamPoll(request: FastifyRequest, reply: FastifyReply, options: StreamOptions): Promise<void>;
//# sourceMappingURL=sse.d.ts.map
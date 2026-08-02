/**
 * Request timeout middleware.
 *
 * Aborts requests that exceed the configured timeout to prevent
 * resource exhaustion and hanging connections.
 */
import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
export interface TimeoutOptions {
    timeoutMs: number;
    errorMessage?: string;
    errorCode?: string;
}
export declare function createTimeoutMiddleware(options?: TimeoutOptions): (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => Promise<void>;
//# sourceMappingURL=timeout.d.ts.map
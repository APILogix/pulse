import type { FastifyReply, FastifyRequest } from 'fastify';
/**
 * A simple backpressure tracker to reject requests if too many operations are active.
 */
export declare class BackpressureTracker {
    private readonly maxActive;
    private activeCount;
    constructor(maxActive: number);
    get active(): number;
    /**
     * Acquire a slot. Returns true if acquired, false if backpressure is applied.
     */
    acquire(): boolean;
    release(): void;
    /**
     * Fastify middleware pattern to enforce backpressure.
     */
    enforce(req: FastifyRequest, reply: FastifyReply, next: () => Promise<void>): Promise<undefined>;
}
//# sourceMappingURL=backpressure.d.ts.map
import type { FastifyRequest, FastifyReply } from 'fastify';
interface RateLimitOptions {
    max: number;
    window: number;
    keyPrefix?: string;
}
export declare function rateLimit(options: RateLimitOptions): (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
export {};
//# sourceMappingURL=rate-limit.d.ts.map
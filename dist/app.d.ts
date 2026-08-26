import type { FastifyInstance } from 'fastify';
declare module 'fastify' {
    interface FastifyRequest {
        startTime: number;
    }
}
export declare function parseTrustProxy(val: string): boolean | string[];
export declare function buildCorsOrigin(additionalAllowed?: string[]): (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => void;
export declare function buildApp(): Promise<FastifyInstance>;
//# sourceMappingURL=app.d.ts.map
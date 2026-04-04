import type { FastifyInstance } from "fastify";
declare module "fastify" {
    interface FastifyRequest {
        startTime: number;
    }
}
export declare function buildApp(): Promise<FastifyInstance>;
//# sourceMappingURL=app.d.ts.map
import type { FastifyBaseLogger } from 'fastify';
export declare function enqueueUserDataExport(userId: string): Promise<string>;
export declare function registerUserDataExportWorker(logger: FastifyBaseLogger): Promise<{
    stop: () => Promise<void>;
}>;
//# sourceMappingURL=queue.d.ts.map
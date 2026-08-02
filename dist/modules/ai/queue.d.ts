import type { FastifyBaseLogger } from 'fastify';
export declare function enqueueAIJob(jobId: string): Promise<string>;
export declare function registerAIWorkers(log: FastifyBaseLogger): Promise<{
    stop: () => Promise<void>;
}>;
//# sourceMappingURL=queue.d.ts.map
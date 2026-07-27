import type { FastifyBaseLogger } from "fastify";
export interface ProjectThresholdTickSummary {
    due: number;
    evaluated: number;
    fired: number;
    recovered: number;
    failed: number;
}
export declare class ProjectThresholdWorker {
    private readonly repository;
    private readonly events;
    private readonly log;
    constructor(logger: FastifyBaseLogger);
    runTick(limit?: number): Promise<ProjectThresholdTickSummary>;
    private findDue;
    private evaluateOne;
    private readMetric;
    private readUsageExpression;
    private emit;
    private resolveActiveEvents;
    private severity;
    private markEvaluated;
}
//# sourceMappingURL=threshold.worker.d.ts.map
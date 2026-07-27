import type { Pool } from "pg";
import type { CreateThresholdBody, ListThresholdsQuery, ProjectAlertThreshold, UpdateThresholdBody } from "./threshold.types.js";
export declare class ThresholdRepository {
    private readonly db;
    constructor(db?: Pool);
    list(organizationId: string, projectId: string, query: ListThresholdsQuery): Promise<{
        thresholds: ProjectAlertThreshold[];
        total: number;
    }>;
    findById(organizationId: string, projectId: string, thresholdId: string): Promise<ProjectAlertThreshold | null>;
    findEnabled(organizationId: string, projectId: string, environmentId?: string | null): Promise<ProjectAlertThreshold[]>;
    create(organizationId: string, projectId: string, actorUserId: string, body: CreateThresholdBody): Promise<ProjectAlertThreshold>;
    update(organizationId: string, projectId: string, thresholdId: string, actorUserId: string, body: UpdateThresholdBody): Promise<ProjectAlertThreshold>;
    toggle(organizationId: string, projectId: string, thresholdId: string, actorUserId: string, enabled: boolean): Promise<ProjectAlertThreshold>;
    delete(organizationId: string, projectId: string, thresholdId: string, actorUserId: string): Promise<ProjectAlertThreshold>;
    markTriggered(organizationId: string, projectId: string, thresholdId: string, triggeredAt: Date, updatedBy?: string | null): Promise<ProjectAlertThreshold>;
    markRecovered(organizationId: string, projectId: string, thresholdId: string, recoveredAt: Date, updatedBy?: string | null): Promise<ProjectAlertThreshold>;
    private markEvaluationTimestamp;
    private withConflictMapping;
    private mapThreshold;
}
//# sourceMappingURL=threshold.repository.d.ts.map
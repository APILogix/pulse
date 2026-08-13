import type { ProjectsService, RequestMeta } from "../../service.js";
import { ThresholdRepository } from "./threshold.repository.js";
import type { CreateThresholdBody, ListThresholdsQuery, ProjectAlertThreshold, ToggleThresholdBody, UpdateThresholdBody } from "./threshold.types.js";
export declare class ThresholdService {
    private readonly repository;
    private readonly projectsService;
    constructor(repository: ThresholdRepository, projectsService: ProjectsService);
    list(orgId: string, projectId: string, userId: string, query: ListThresholdsQuery): Promise<{
        thresholds: ProjectAlertThreshold[];
        total: number;
        limit: number;
        offset: number;
    }>;
    get(orgId: string, projectId: string, thresholdId: string, userId: string): Promise<ProjectAlertThreshold>;
    create(orgId: string, projectId: string, userId: string, _body: CreateThresholdBody, _meta: RequestMeta): Promise<ProjectAlertThreshold>;
    update(orgId: string, projectId: string, thresholdId: string, userId: string, _body: UpdateThresholdBody, _meta: RequestMeta): Promise<ProjectAlertThreshold>;
    delete(orgId: string, projectId: string, thresholdId: string, userId: string, _meta: RequestMeta): Promise<void>;
    toggle(orgId: string, projectId: string, thresholdId: string, userId: string, _body: ToggleThresholdBody, _meta: RequestMeta): Promise<ProjectAlertThreshold>;
    private requireThreshold;
    private audit;
    private auditValues;
}
//# sourceMappingURL=threshold.service.d.ts.map
import { ProjectMemberRole } from "../../types.js";
import { ProjectError } from "../../shared/utils.js";
import { ThresholdRepository } from "./threshold.repository.js";
export class ThresholdService {
    repository;
    projectsService;
    constructor(repository, projectsService) {
        this.repository = repository;
        this.projectsService = projectsService;
    }
    async list(orgId, projectId, userId, query) {
        await this.projectsService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
        const result = await this.repository.list(orgId, projectId, query);
        return {
            ...result,
            limit: query.limit,
            offset: query.offset ?? ((query.page ?? 1) - 1) * query.limit,
        };
    }
    async get(orgId, projectId, thresholdId, userId) {
        await this.projectsService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
        return this.requireThreshold(orgId, projectId, thresholdId);
    }
    async create(orgId, projectId, userId, _body, _meta) {
        await this.projectsService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
        throw new ProjectError("ALERT_THRESHOLD_DEPRECATED", "Project threshold writes are deprecated; use canonical alert rule bindings", 410);
    }
    async update(orgId, projectId, thresholdId, userId, _body, _meta) {
        await this.projectsService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
        throw new ProjectError("ALERT_THRESHOLD_DEPRECATED", "Project threshold writes are deprecated; use canonical alert rule bindings", 410);
    }
    async delete(orgId, projectId, thresholdId, userId, _meta) {
        await this.projectsService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
        throw new ProjectError("ALERT_THRESHOLD_DEPRECATED", "Project threshold writes are deprecated; use canonical alert rule bindings", 410);
    }
    async toggle(orgId, projectId, thresholdId, userId, _body, _meta) {
        await this.projectsService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
        throw new ProjectError("ALERT_THRESHOLD_DEPRECATED", "Project threshold writes are deprecated; use canonical alert rule bindings", 410);
    }
    async requireThreshold(orgId, projectId, thresholdId) {
        const threshold = await this.repository.findById(orgId, projectId, thresholdId);
        if (!threshold) {
            throw new ProjectError("ALERT_THRESHOLD_NOT_FOUND", "Alert threshold not found", 404);
        }
        return threshold;
    }
    async audit(meta, orgId, projectId, action, entityId, oldThreshold, newThreshold) {
        await this.projectsService.audit(meta, {
            orgId,
            projectId,
            action,
            entityType: "project_alert_threshold",
            entityId,
            oldValues: oldThreshold ? this.auditValues(oldThreshold) : null,
            newValues: this.auditValues(newThreshold),
            metadata: { projectId },
        });
    }
    auditValues(threshold) {
        return {
            environmentId: threshold.environmentId,
            thresholdKey: threshold.thresholdKey,
            metricName: threshold.metricName,
            metricSource: threshold.metricSource,
            category: threshold.category,
            severity: threshold.severity,
            comparisonOperator: threshold.comparisonOperator,
            thresholdValue: threshold.thresholdValue,
            thresholdUnit: threshold.thresholdUnit,
            evaluationWindowMinutes: threshold.evaluationWindowMinutes,
            cooldownMinutes: threshold.cooldownMinutes,
            consecutiveBreaches: threshold.consecutiveBreaches,
            enabled: threshold.enabled,
            notifyOnRecovery: threshold.notifyOnRecovery,
            version: threshold.version,
        };
    }
}
//# sourceMappingURL=threshold.service.js.map
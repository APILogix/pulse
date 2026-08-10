import { ProjectMemberRole } from "../../types.js";
import type { ProjectsService, RequestMeta } from "../../service.js";
import { ProjectError } from "../../shared/utils.js";
import { ThresholdRepository } from "./threshold.repository.js";
import type {
  CreateThresholdBody,
  ListThresholdsQuery,
  ProjectAlertThreshold,
  ToggleThresholdBody,
  UpdateThresholdBody,
} from "./threshold.types.js";

export class ThresholdService {
  constructor(
    private readonly repository: ThresholdRepository,
    private readonly projectsService: ProjectsService,
  ) {}

  async list(
    orgId: string,
    projectId: string,
    userId: string,
    query: ListThresholdsQuery,
  ): Promise<{ thresholds: ProjectAlertThreshold[]; total: number; limit: number; offset: number }> {
    await this.projectsService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
    const result = await this.repository.list(orgId, projectId, query);
    return {
      ...result,
      limit: query.limit,
      offset: query.offset ?? ((query.page ?? 1) - 1) * query.limit,
    };
  }

  async get(
    orgId: string,
    projectId: string,
    thresholdId: string,
    userId: string,
  ): Promise<ProjectAlertThreshold> {
    await this.projectsService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
    return this.requireThreshold(orgId, projectId, thresholdId);
  }

  async create(
    orgId: string,
    projectId: string,
    userId: string,
    _body: CreateThresholdBody,
    _meta: RequestMeta,
  ): Promise<ProjectAlertThreshold> {
    await this.projectsService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
    throw new ProjectError(
      "ALERT_THRESHOLD_DEPRECATED",
      "Project threshold writes are deprecated; use canonical alert rule bindings",
      410,
    );
  }

  async update(
    orgId: string,
    projectId: string,
    thresholdId: string,
    userId: string,
    _body: UpdateThresholdBody,
    _meta: RequestMeta,
  ): Promise<ProjectAlertThreshold> {
    await this.projectsService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
    throw new ProjectError(
      "ALERT_THRESHOLD_DEPRECATED",
      "Project threshold writes are deprecated; use canonical alert rule bindings",
      410,
    );
  }

  async delete(
    orgId: string,
    projectId: string,
    thresholdId: string,
    userId: string,
    _meta: RequestMeta,
  ): Promise<void> {
    await this.projectsService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
    throw new ProjectError(
      "ALERT_THRESHOLD_DEPRECATED",
      "Project threshold writes are deprecated; use canonical alert rule bindings",
      410,
    );
  }

  async toggle(
    orgId: string,
    projectId: string,
    thresholdId: string,
    userId: string,
    _body: ToggleThresholdBody,
    _meta: RequestMeta,
  ): Promise<ProjectAlertThreshold> {
    await this.projectsService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
    throw new ProjectError(
      "ALERT_THRESHOLD_DEPRECATED",
      "Project threshold writes are deprecated; use canonical alert rule bindings",
      410,
    );
  }

  private async requireThreshold(
    orgId: string,
    projectId: string,
    thresholdId: string,
  ): Promise<ProjectAlertThreshold> {
    const threshold = await this.repository.findById(orgId, projectId, thresholdId);
    if (!threshold) {
      throw new ProjectError("ALERT_THRESHOLD_NOT_FOUND", "Alert threshold not found", 404);
    }
    return threshold;
  }

  private async audit(
    meta: RequestMeta,
    orgId: string,
    projectId: string,
    action: string,
    entityId: string,
    oldThreshold: ProjectAlertThreshold | null,
    newThreshold: ProjectAlertThreshold,
  ): Promise<void> {
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

  private auditValues(threshold: ProjectAlertThreshold): Record<string, unknown> {
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
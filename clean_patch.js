import fs from 'fs';
import path from 'path';

const servicePath = path.resolve('./src/modules/projects/service.ts');
let content = fs.readFileSync(servicePath, 'utf8');

content = content.replace(
  /} from "\.\/repository\.js";/,
  `} from "./repository.js";
import { SettingsRepository } from "./settings.repository.js";
import { ApiKeyRepository } from "./api-key.repository.js";
import { UsageRepository } from "./usage.repository.js";`
);

content = content.replace(
  /UpdateProjectBody,\n  ValidatedApiKey,\n} from "\.\/types\.js";/,
  `UpdateProjectBody,
  ValidatedApiKey,
} from "./types.js";
import { ProjectMemberRole, type ProjectOverviewDto, type ProjectSettings } from "./types.js";`
);

content = content.replace(
  /const BILLING_MUTABLE_STATUSES = new Set\(\["trialing", "active"\]\);/,
  `const BILLING_MUTABLE_STATUSES = new Set(["trialing", "active"]);

const ROLE_HIERARCHY: Record<ProjectMemberRole, number> = {
  [ProjectMemberRole.OWNER]: 4,
  [ProjectMemberRole.ADMIN]: 3,
  [ProjectMemberRole.DEVELOPER]: 2,
  [ProjectMemberRole.VIEWER]: 1,
};

export function hasProjectRole(userRole: ProjectMemberRole, required: ProjectMemberRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[required];
}`
);

content = content.replace(
  /    private readonly orgRepo: OrganizationRepository,\n  \) \{\}/,
  `    private readonly orgRepo: OrganizationRepository,
    private readonly settingsRepository: SettingsRepository,
    private readonly apiKeyRepository: ApiKeyRepository,
    private readonly usageRepository: UsageRepository,
  ) {}`
);

const requireProjectAccessBlock = `  public async requireProjectAccess(
    orgId: string,
    projectId: string,
    userId: string,
    requiredRole: OrgRole,
  ): Promise<Project> {
    // Tenant isolation root check: caller MUST be an active org member, the
    // project must belong to that org, and the caller must be a project member.
    const membership = await this.requireOrganizationAccess(orgId, userId, "viewer");
    const project = await this.repository.findProjectById(orgId, projectId);
    if (!project) throw new ProjectError("PROJECT_NOT_FOUND", "Project not found", 404);

    const projectMember = await this.repository.findProjectMember(projectId, userId);
    if (!projectMember) {
      throw new ProjectError(
        "INSUFFICIENT_PERMISSIONS",
        "Project membership is required",
        403,
      );
    }

    if (requiredRole !== "viewer" && requiredRole !== "member" && !hasRequiredRole(membership.role, requiredRole)) {
      throw new ProjectError(
        "INSUFFICIENT_PERMISSIONS",
        \`Requires \${requiredRole} role or higher\`,
        403,
      );
    }

    return project;
  }`;

const newRequireProjectAccessBlock = `  public async requireProjectAccess(
    orgId: string,
    projectId: string,
    userId: string,
    requiredRole: ProjectMemberRole | OrgRole | string = "viewer",
  ): Promise<Project> {
    const membership = await this.requireOrganizationAccess(orgId, userId, "viewer");
    const project = await this.repository.findProjectById(orgId, projectId);
    if (!project) throw new ProjectError("PROJECT_NOT_FOUND", "Project not found", 404);

    const projectMember = await this.repository.findProjectMember(projectId, userId);
    
    // Organization admins implicitly have owner access to all projects in the org
    if (membership.role === "admin" || membership.role === "owner") {
      return project;
    }

    if (!projectMember || projectMember.status !== 'active') {
      throw new ProjectError(
        "INSUFFICIENT_PERMISSIONS",
        "Active project membership is required",
        403,
      );
    }

    if (Object.values(ProjectMemberRole).includes(requiredRole as any)) {
      if (!hasProjectRole(projectMember.role, requiredRole as ProjectMemberRole)) {
        throw new ProjectError(
          "INSUFFICIENT_PERMISSIONS",
          \`Requires \${requiredRole} role or higher\`,
          403,
        );
      }
    } else {
      if (requiredRole !== "viewer" && requiredRole !== "member" && !hasRequiredRole(membership.role, requiredRole as OrgRole)) {
        throw new ProjectError(
          "INSUFFICIENT_PERMISSIONS",
          \`Requires \${requiredRole} role or higher\`,
          403,
        );
      }
    }

    return project;
  }`;

content = content.replace(requireProjectAccessBlock, newRequireProjectAccessBlock);

const environmentsSection = `  // ── Environments ─────────────────────────────────────────────────────────`;
const settingsAndOverviewBlock = `  // ── Settings and Overview ────────────────────────────────────────────────
  async getProjectSettings(orgId: string, projectId: string, userId: string): Promise<ProjectSettings> {
    await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
    let settings = await this.settingsRepository.findByProjectId(projectId);
    if (!settings) {
      settings = await this.settingsRepository.createDefault(projectId, orgId);
    }
    return settings;
  }

  async updateProjectSettings(
    orgId: string,
    projectId: string,
    userId: string,
    updates: Partial<ProjectSettings>,
    meta: RequestMeta
  ): Promise<ProjectSettings> {
    await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
    const updated = await this.settingsRepository.update(projectId, updates);
    
    await this.audit(meta, {
      orgId,
      action: "project.settings_updated",
      entityType: "project_settings",
      entityId: projectId,
      changedFields: Object.keys(updates),
    });
    return updated;
  }

  async getProjectOverview(
    orgId: string,
    projectId: string,
    userId: string
  ): Promise<ProjectOverviewDto> {
    const project = await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
    
    const [members, apiKeys, settings] = await Promise.all([
      this.repository.findProjectMembers(projectId),
      this.apiKeyRepository.findByProjectId(projectId),
      this.getProjectSettings(orgId, projectId, userId)
    ]);
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dailyUsage = await this.usageRepository.getDailyTrend(projectId, thirtyDaysAgo, new Date());
    
    const eventsLast30d = dailyUsage.reduce((sum, day) => sum + day.totalEvents, 0);
    
    return {
      project,
      members,
      apiKeys,
      settings,
      stats: {
        eventsLast30d,
        activeAlerts: 0,
        errorRate: 0
      }
    };
  }

  // ── Environments ─────────────────────────────────────────────────────────`;

content = content.replace(environmentsSection, settingsAndOverviewBlock);

fs.writeFileSync(servicePath, content);
console.log('Successfully patched service.ts cleanly');

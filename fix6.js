import fs from 'fs';

let p = 'src/modules/projects/service.ts';
let c = fs.readFileSync(p, 'utf8');

// Normalize CRLF to LF
c = c.replace(/\r\n/g, '\n');

// 1. Add normal imports for the new types
c = c.replace(
  /import \{\n  ProjectsRepository,\n/g,
  `import { ProjectMemberRole, type ProjectOverviewDto, type ProjectSettings } from "./types.js";\nimport {\n  ProjectsRepository,\n`
);

// 2. Add repository imports
c = c.replace(
  /\} from "\.\/repository\.js";/g,
  `} from "./repository.js";\nimport { SettingsRepository } from "./settings.repository.js";\nimport { ApiKeyRepository } from "./api-key.repository.js";\nimport { UsageRepository } from "./usage.repository.js";`
);

// 3. Add ROLE_HIERARCHY and hasProjectRole
c = c.replace(
  /const BILLING_MUTABLE_STATUSES = new Set\(\["trialing", "active"\]\);/g,
  `const BILLING_MUTABLE_STATUSES = new Set(["trialing", "active"]);\n\nconst ROLE_HIERARCHY: Record<ProjectMemberRole, number> = {\n  [ProjectMemberRole.OWNER]: 4,\n  [ProjectMemberRole.ADMIN]: 3,\n  [ProjectMemberRole.DEVELOPER]: 2,\n  [ProjectMemberRole.VIEWER]: 1,\n};\n\nexport function hasProjectRole(userRole: ProjectMemberRole, required: ProjectMemberRole): boolean {\n  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[required];\n}`
);

// 4. Update constructor DI
c = c.replace(
  /    private readonly orgRepo: OrganizationRepository,\n  \) \{\}/g,
  `    private readonly orgRepo: OrganizationRepository,\n    private readonly settingsRepository: SettingsRepository,\n    private readonly apiKeyRepository: ApiKeyRepository,\n    private readonly usageRepository: UsageRepository,\n  ) {}`
);

// 5. getProject and new overview/settings methods
c = c.replace(
  /  async getProject\(orgId: string, projectId: string, userId: string\): Promise<Project> \{\n    return this\.requireProjectAccess\(orgId, projectId, userId, "member"\);\n  \}/g,
  `  async getProject(orgId: string, projectId: string, userId: string): Promise<Project> {
    return this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
  }

  async getProjectSettings(orgId: string, projectId: string, userId: string): Promise<ProjectSettings> {
    await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
    const settings = await this.settingsRepository.findByProjectId(projectId);
    if (!settings) throw new ProjectError("SETTINGS_NOT_FOUND", "Project settings not found", 404);
    return settings;
  }

  async updateProjectSettings(
    orgId: string,
    projectId: string,
    userId: string,
    updates: Partial<Omit<ProjectSettings, "id" | "projectId" | "organizationId" | "createdAt" | "updatedAt">>,
    meta: RequestMeta
  ): Promise<ProjectSettings> {
    await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
    const result = await this.settingsRepository.update(projectId, updates);

    await this.audit(meta, {
      orgId,
      action: "project.settings.updated",
      entityType: "project_settings",
      entityId: result.id,
      newValues: updates as any,
    });

    return result;
  }

  async getProjectOverview(orgId: string, projectId: string, userId: string): Promise<ProjectOverviewDto> {
    const project = await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
    const settings = await this.settingsRepository.findByProjectId(projectId);
    if (!settings) throw new ProjectError("SETTINGS_NOT_FOUND", "Project settings not found", 404);
    
    const members = (this.repository as any).findProjectMembers ? await (this.repository as any).findProjectMembers(orgId, projectId) : [];
    const apiKeys = await (this.apiKeyRepository as any).listApiKeys(orgId, projectId);

    const now = new Date();
    const usage = {
      totalEventsToday: 0,
      totalBytesToday: 0,
      peakHour: 0,
      currentHourEvents: 0,
      categoryBreakdown: {},
      eventTypeBreakdown: {},
      hourlyBreakdown: [],
      dailyTrend: [],
      heatmapData: []
    };

    return {
      project,
      settings,
      memberCount: members.length,
      apiKeyCount: apiKeys.length,
      usage,
    };
  }`
);

// 6. Update requireProjectAccess
c = c.replace(
  /  public async requireProjectAccess\([\s\S]*?return project;\n  \}/m,
  `  public async requireProjectAccess(
    orgId: string,
    projectId: string,
    userId: string,
    requiredRole: OrgRole | ProjectMemberRole,
  ): Promise<Project> {
    const project = await this.repository.findProjectById(orgId, projectId);
    if (!project) throw new ProjectError("PROJECT_NOT_FOUND", "Project not found", 404);

    if (requiredRole === "owner" || requiredRole === "admin" || requiredRole === "member" || requiredRole === "billing") {
      await this.requireOrganizationAccess(orgId, userId, requiredRole);
      return project;
    }

    try {
      await this.requireOrganizationAccess(orgId, userId);
    } catch (err) {
      throw err;
    }

    if ((this.repository as any).getProjectMemberRole) {
      const userProjectRole = await (this.repository as any).getProjectMemberRole(orgId, projectId, userId);
      if (userProjectRole) {
         if (!hasProjectRole(userProjectRole, requiredRole as ProjectMemberRole)) {
           throw new ProjectError("FORBIDDEN", "Insufficient project role", 403);
         }
         return project;
      }
    }

    return project;
  }`
);

// Remove the `type` modifiers from ProjectOverviewDto and ProjectSettings if they are still in `types.ts` imports
c = c.replace(/  type ProjectOverviewDto,\n/g, '');
c = c.replace(/  type ProjectSettings,\n/g, '');
c = c.replace(/  ProjectMemberRole,\n/g, '');

fs.writeFileSync(p, c);
console.log('Fixed service.ts');

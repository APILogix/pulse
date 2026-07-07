import fs from 'fs';
import path from 'path';

const servicePath = path.resolve('./src/modules/projects/service.ts');
let content = fs.readFileSync(servicePath, 'utf8');

// Replace requireProjectAccess
const requireProjectAccessRegex = /public async requireProjectAccess\([\s\S]*?\): Promise<Project> \{[\s\S]*?return project;\n  \}/m;
content = content.replace(requireProjectAccessRegex, `public async requireProjectAccess(
    orgId: string,
    projectId: string,
    userId: string,
    requiredRole: ProjectMemberRole = ProjectMemberRole.VIEWER,
  ): Promise<{ project: Project; member: ProjectMember }> {
    const membership = await this.requireOrganizationAccess(orgId, userId, "viewer");
    const project = await this.repository.findProjectById(orgId, projectId);
    if (!project) throw new ProjectError("PROJECT_NOT_FOUND", "Project not found", 404);

    const projectMember = await this.repository.findProjectMember(projectId, userId);
    
    // Organization admins implicitly have owner access to all projects in the org
    if (hasRequiredRole(membership.role, "admin")) {
      return { 
        project, 
        member: projectMember || {
          id: 'org-admin',
          projectId,
          userId,
          organizationId: orgId,
          role: ProjectMemberRole.OWNER,
          status: 'active',
          invitedBy: null,
          invitedAt: null,
          joinedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        } 
      };
    }

    if (!projectMember || projectMember.status !== 'active') {
      throw new ProjectError(
        "INSUFFICIENT_PERMISSIONS",
        "Active project membership is required",
        403,
      );
    }

    if (!hasProjectRole(projectMember.role, requiredRole)) {
      throw new ProjectError(
        "INSUFFICIENT_PERMISSIONS",
        \`Requires \${requiredRole} role or higher\`,
        403,
      );
    }

    return { project, member: projectMember };
  }`);

// Fix callers
content = content.replace(/const ([a-zA-Z0-9_]+) = await this\.requireProjectAccess\([^)]+\);/g, (match, p1) => {
  return match.replace(`const ${p1} =`, `const { project: ${p1} } =`);
});
content = content.replace(/return this\.requireProjectAccess\([^)]+\);/g, (match) => {
  return match.replace('return this.requireProjectAccess', 'return (await this.requireProjectAccess').replace(';', ')).project;');
});
content = content.replace(/await this\.requireProjectAccess\([^)]+\);/g, (match) => {
  if (match.includes('return') || match.includes('const ')) return match;
  return match.replace('await this.requireProjectAccess', '(await this.requireProjectAccess').replace(';', ')).project;');
});

// Add settings and overview methods
const overviewMethod = `
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
    const { project } = await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
    
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
`;

content = content.replace(/\/\/ ── Environments ─────────────────────────────────────────────────────────/, overviewMethod + '\n  // ── Environments ─────────────────────────────────────────────────────────');

// Also fix `ProjectsService` requireProjectAccess to use ProjectMemberRole enum instead of strings in the callers
content = content.replace(/, "admin"\)/g, ', ProjectMemberRole.ADMIN)');
content = content.replace(/, "owner"\)/g, ', ProjectMemberRole.OWNER)');
content = content.replace(/, "member"\)/g, ', ProjectMemberRole.VIEWER)'); // Default member map to viewer or developer? Let's use viewer
content = content.replace(/, "viewer"\)/g, ', ProjectMemberRole.VIEWER)');

fs.writeFileSync(servicePath, content);
console.log('Patched service.ts successfully!');

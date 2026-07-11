import { pool } from "../../config/database.js";
import { ProjectError } from "./shared/utils.js";
import { ProjectRepository } from "./core/project.repository.js";
import { MemberRepository } from "./members/member.repository.js";
import { ProjectUsageRepository } from "./usage/project-usage.repository.js";
import { ProjectSettingsRepository } from "./settings/project-settings.repository.js";
// Column list selected for every project read. Centralized so the projection
// stays consistent across find/list/update.
const PROJECT_COLUMNS = `
  id, org_id, name, slug, description, status, default_environment AS environment,
  archived_at, deleted_at, created_at, updated_at
`;
const API_KEY_COLUMNS = `
  id, project_id, org_id, key_hash, key_prefix, key_type, environment,
  name, description, is_active, status, created_by,
  rotated_from_key_id, rotated_at, rotated_by, rotation_reason, grace_period_ends_at,
  revoked_at, revoked_by, revoked_reason, expires_at,
  auto_rotate_enabled, auto_rotate_days,
  last_used_at, last_used_ip, usage_count, error_count,
  rate_limit_per_second, rate_limit_per_minute, rate_limit_per_hour,
  permissions, allowed_endpoints, blocked_endpoints, metadata,
  created_at, updated_at
`;
const ENV_COLUMNS = `
  id, project_id, org_id, environment, is_active,
  rate_limit_per_second, rate_limit_per_minute, rate_limit_per_hour, burst_limit,
  allowed_event_types, max_event_size_bytes, max_batch_size,
  require_https, ip_allowlist, ip_blocklist, alert_email, alert_webhook_url,
  created_by, created_at, updated_at
`;
const DEFAULT_PROJECT_ENVIRONMENTS = ["development", "staging", "production"];
export class ProjectsRepository {
    db;
    core;
    members;
    usage;
    settings;
    constructor(db = pool) {
        this.db = db;
        this.core = new ProjectRepository(db);
        this.members = new MemberRepository(db);
        this.usage = new ProjectUsageRepository(db);
        this.settings = new ProjectSettingsRepository(db);
    }
    async withTransaction(callback) {
        return this.core.withTransaction(arguments[0]);
    }
    // ── Membership ────────────────────────────────────────────────────────────
    async findOrganizationMembership(orgId, userId, client) {
        return this.members.findOrganizationMembership(orgId, userId, client);
    }
    // ── Projects ────────────────────────────────────────────────────────────────
    async listProjects(orgId, query, client) {
        return this.core.listProjects(orgId, query, client);
    }
    async createProject(input, client) {
        return this.core.createProject(input, client);
    }
    async findProjectBySlug(orgId, slug, client) {
        return this.core.findProjectBySlug(orgId, slug, client);
    }
    async findProjectById(orgId, projectId, client) {
        return this.core.findProjectById(orgId, projectId, client);
    }
    async findProjectByIdIncludingDeleted(orgId, projectId, client) {
        return this.core.findProjectByIdIncludingDeleted(orgId, projectId, client);
    }
    async updateProject(orgId, projectId, input, client) {
        return this.core.updateProject(orgId, projectId, input, client);
    }
    /** Soft-delete: stamp deleted_at + deleted_by; row is retained for audit. */
    async softDeleteProject(orgId, projectId, deletedBy, client) {
        return this.core.softDeleteProject(orgId, projectId, deletedBy, client);
    }
    async restoreProject(orgId, projectId, client) {
        return this.core.restoreProject(orgId, projectId, client);
    }
    async getProjectStats(projectId, client) {
        return this.usage.getProjectStats(projectId, client);
    }
    async getProjectUsageCounters(projectId, client) {
        return this.usage.getProjectUsageCounters(projectId, client);
    }
    async getProjectModuleUsageCounts(orgId, client) {
        return this.usage.getProjectModuleUsageCounts(orgId, client);
    }
    async findSdkConfigPlanKey(orgId, client) {
        return this.settings.findSdkConfigPlanKey(orgId, client);
    }
    async createDefaultSdkConfigs(project, createdBy, planKey, client) {
        return this.settings.createDefaultSdkConfigs(project, createdBy, planKey, client);
    }
}
export * from "./core/project.repository.js";
export * from "./members/member.repository.js";
export * from "./usage/project-usage.repository.js";
export * from "./settings/project-settings.repository.js";
//# sourceMappingURL=repository.js.map
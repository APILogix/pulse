import { evictSdkConfigCache, sdkConfigCache, sdkConfigCacheKey } from "../../../config/lrucashe.js";
import { syncEnvironmentSdkConfigLookupToLogDbBestEffort } from "../../../shared/logdb/lookup-sync.js";
import { validateSchemaV1 } from "../../projects/sdk-config/validator.js";
import { SdkConfigRepository } from "./sdk-config.repository.js";
import { ForbiddenError, NotFoundError, ValidationError, hasMinRole, } from "../types.js";
function assertStoredConfig(row) {
    validateSchemaV1(row.compiled_snapshot);
}
function toConfigDto(row) {
    assertStoredConfig(row);
    return {
        id: row.id,
        orgId: row.organization_id,
        projectId: row.project_id,
        environmentId: row.environment_id,
        environmentName: row.environment_name,
        environmentSlug: row.environment_slug,
        publishedRevisionId: row.published_revision_id,
        revision: row.current_revision,
        revisionHash: row.current_hash,
        compiledSnapshot: row.compiled_snapshot,
        schemaVersion: 1,
        publishedAt: row.published_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        version: row.version,
    };
}
function toVersionDto(row) {
    assertStoredConfig(row);
    return {
        id: row.id,
        configId: row.config_id,
        orgId: row.organization_id,
        projectId: row.project_id,
        environmentId: row.environment_id,
        environmentName: row.environment_name,
        environmentSlug: row.environment_slug,
        revision: row.revision_number,
        revisionHash: row.config_hash,
        compiledSnapshot: row.compiled_snapshot,
        schemaVersion: 1,
        changeType: row.change_type,
        changeSummary: row.change_summary,
        rolledBackToRevision: row.rolled_back_to_revision,
        publishedBy: row.published_by,
        publishedAt: row.published_at,
    };
}
/** Admin facade. Compilation, validation, hashing, and revision writes are delegated to the canonical service. */
export class SdkConfigService {
    repo;
    orgRepo;
    auditService;
    canonical;
    constructor(repo, orgRepo, auditService, canonical) {
        this.repo = repo;
        this.orgRepo = orgRepo;
        this.auditService = auditService;
        this.canonical = canonical;
    }
    async requireAdmin(orgId, userId) {
        const member = await this.orgRepo.findActiveMember(orgId, userId);
        if (!member || !hasMinRole(member.role, "admin")) {
            throw new ForbiddenError("Requires organization admin role or higher");
        }
    }
    async requireMember(orgId, userId) {
        if (!(await this.orgRepo.findActiveMember(orgId, userId))) {
            throw new ForbiddenError("Not a member of this organization");
        }
    }
    scope(row) {
        return {
            organizationId: row.organization_id,
            projectId: row.project_id,
            environmentId: row.environment_id,
            environmentKey: row.environment_slug,
        };
    }
    async audit(meta, orgId, projectId, action, entityId, newValues) {
        await this.auditService.audit(meta, {
            orgId,
            projectId,
            action,
            entityType: "environment_sdk_config",
            entityId,
            newValues,
        });
    }
    async listConfigs(orgId, userId, filters, query) {
        await this.requireMember(orgId, userId);
        const result = await this.repo.list(orgId, filters, query);
        return { data: result.data.map(toConfigDto), meta: result.meta };
    }
    async getConfig(orgId, userId, configId) {
        await this.requireMember(orgId, userId);
        const row = await this.repo.findById(orgId, configId);
        if (!row)
            throw new NotFoundError("SDK config");
        return toConfigDto(row);
    }
    async updateConfig(meta, orgId, configId, input) {
        await this.requireAdmin(orgId, meta.actorUserId);
        return this.publish(meta, orgId, configId, input);
    }
    async updateProjectConfig(meta, orgId, projectId, configId, input) {
        await this.requireMember(orgId, meta.actorUserId);
        const current = await this.repo.findById(orgId, configId);
        if (!current || current.project_id !== projectId)
            throw new NotFoundError("SDK config");
        return this.publish(meta, orgId, configId, input, current);
    }
    async publish(meta, orgId, configId, input, loaded) {
        const current = loaded ?? await this.repo.findById(orgId, configId);
        if (!current)
            throw new NotFoundError("SDK config");
        await this.canonical.publish(this.scope(current), {
            method: "PUT",
            body: { editableConfig: input.editableConfig },
            actorId: meta.actorUserId,
        });
        evictSdkConfigCache(current.environment_id);
        syncEnvironmentSdkConfigLookupToLogDbBestEffort(current.environment_id, "sdk_config.published");
        const row = await this.repo.findById(orgId, configId);
        if (!row)
            throw new NotFoundError("SDK config");
        await this.audit(meta, orgId, row.project_id, "sdk_config.published", configId, {
            environmentId: row.environment_id,
            revision: row.current_revision,
            revisionHash: row.current_hash,
            changeSummary: input.changeSummary ?? null,
        });
        return toConfigDto(row);
    }
    async rollbackConfig(meta, orgId, configId, toRevision, reason) {
        await this.requireAdmin(orgId, meta.actorUserId);
        const current = await this.repo.findById(orgId, configId);
        if (!current)
            throw new NotFoundError("SDK config");
        if (toRevision >= current.current_revision) {
            throw new ValidationError("Rollback target must be an earlier revision");
        }
        await this.canonical.rollback(this.scope(current), toRevision, meta.actorUserId);
        evictSdkConfigCache(current.environment_id);
        syncEnvironmentSdkConfigLookupToLogDbBestEffort(current.environment_id, "sdk_config.rolled_back");
        const row = await this.repo.findById(orgId, configId);
        if (!row)
            throw new NotFoundError("SDK config");
        await this.audit(meta, orgId, row.project_id, "sdk_config.rolled_back", configId, {
            environmentId: row.environment_id,
            revision: row.current_revision,
            rolledBackToRevision: toRevision,
            reason,
        });
        return toConfigDto(row);
    }
    async listVersions(orgId, userId, configId) {
        await this.getConfig(orgId, userId, configId);
        return (await this.repo.listVersions(configId)).map(toVersionDto);
    }
    async getVersion(orgId, userId, configId, revision) {
        await this.getConfig(orgId, userId, configId);
        const row = await this.repo.getVersion(configId, revision);
        if (!row)
            throw new NotFoundError(`Revision ${revision}`);
        return toVersionDto(row);
    }
    async resolveForSdk(orgId, userId, query) {
        await this.requireMember(orgId, userId);
        const key = sdkConfigCacheKey(query.environmentId);
        const cached = sdkConfigCache.get(key);
        if (cached)
            return cached;
        const resolved = await this.repo.resolveForEnvironment(orgId, query.environmentId);
        if (!resolved)
            throw new NotFoundError("SDK config");
        validateSchemaV1(resolved.compiledSnapshot);
        sdkConfigCache.set(key, resolved);
        return resolved;
    }
}
//# sourceMappingURL=sdk-config.service.js.map
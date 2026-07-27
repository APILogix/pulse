/** Business logic for environment-owned published SDK configuration. */
import { createHash } from "crypto";
import { evictSdkConfigCache, sdkConfigCache, sdkConfigCacheKey } from "../../../config/lrucashe.js";
import { SdkConfigRepository } from "./sdk-config.repository.js";
import { ForbiddenError, NotFoundError, ValidationError, hasMinRole, } from "../types.js";
function canonicalize(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(canonicalize).join(",")}]`;
    const object = value;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(",")}}`;
}
function configHash(value) {
    return createHash("sha256").update(canonicalize(value)).digest("hex");
}
function toConfigDto(row) {
    return {
        id: row.id,
        orgId: row.organization_id,
        projectId: row.project_id,
        environmentId: row.environment_id,
        publishedRevisionId: row.published_revision_id,
        revision: row.current_revision,
        revisionHash: row.current_hash,
        configValue: row.config_value,
        schemaVersion: row.schema_version,
        publishedAt: row.published_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        version: row.version,
    };
}
function toVersionDto(row) {
    return {
        id: row.id,
        configId: row.config_id,
        orgId: row.organization_id,
        projectId: row.project_id,
        environmentId: row.environment_id,
        revision: row.revision_number,
        revisionHash: row.config_hash,
        configValue: row.config_value,
        schemaVersion: row.schema_version,
        changeType: row.change_type,
        changeSummary: row.change_summary,
        rolledBackToRevision: row.rolled_back_to_revision,
        publishedBy: row.published_by,
        publishedAt: row.published_at,
    };
}
export class SdkConfigService {
    repo;
    orgRepo;
    log;
    constructor(repo, orgRepo, log) {
        this.repo = repo;
        this.orgRepo = orgRepo;
        this.log = log;
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
    async audit(meta, orgId, action, entityId, newValues) {
        try {
            await this.orgRepo.createAuditLog({
                orgId,
                action,
                entityType: "environment_sdk_config",
                entityId,
                actorUserId: meta.actorUserId,
                actorEmail: meta.actorEmail,
                actorIp: meta.actorIp,
                actorUserAgent: meta.actorUserAgent,
                actorSessionId: meta.actorSessionId,
                requestId: meta.requestId,
                httpMethod: meta.httpMethod,
                endpoint: meta.endpoint,
                newValues,
            });
        }
        catch (error) {
            this.log.error({ err: error }, "SDK config audit write failed");
        }
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
        return this.publish(meta, orgId, configId, input);
    }
    async publish(meta, orgId, configId, input) {
        const current = await this.repo.findById(orgId, configId);
        if (!current)
            throw new NotFoundError("SDK config");
        const hash = configHash(input.configValue);
        if (hash === current.current_hash && (input.schemaVersion ?? current.schema_version) === current.schema_version) {
            throw new ValidationError("Published configuration is unchanged");
        }
        const row = await this.repo.publish(orgId, configId, {
            configValue: input.configValue,
            configHash: hash,
            schemaVersion: input.schemaVersion === undefined ? current.schema_version : input.schemaVersion,
            changeType: "publish",
            changeSummary: input.changeSummary ?? null,
            publishedBy: meta.actorUserId,
        });
        evictSdkConfigCache(row.environment_id);
        await this.audit(meta, orgId, "sdk_config.published", configId, {
            environmentId: row.environment_id,
            revision: row.current_revision,
            revisionHash: row.current_hash,
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
        const target = await this.repo.getVersion(configId, toRevision);
        if (!target)
            throw new NotFoundError(`Revision ${toRevision}`);
        const row = await this.repo.publish(orgId, configId, {
            configValue: target.config_value,
            configHash: target.config_hash,
            schemaVersion: target.schema_version,
            changeType: "rollback",
            changeSummary: reason,
            rolledBackToRevision: toRevision,
            publishedBy: meta.actorUserId,
        });
        evictSdkConfigCache(row.environment_id);
        await this.audit(meta, orgId, "sdk_config.rolled_back", configId, {
            environmentId: row.environment_id,
            revision: row.current_revision,
            rolledBackToRevision: toRevision,
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
        sdkConfigCache.set(key, resolved);
        return resolved;
    }
}
//# sourceMappingURL=sdk-config.service.js.map
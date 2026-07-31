import type { OrganizationAuditService } from "../audit-logs/audit-logs.service.js";
import { evictSdkConfigCache, sdkConfigCache, sdkConfigCacheKey } from "../../../config/lrucashe.js";
import { syncEnvironmentSdkConfigLookupToLogDbBestEffort } from "../../../shared/logdb/lookup-sync.js";
import type { OrganizationRepository } from "../repository.js";
import type { RemoteSdkConfigService, ConfigScope } from "../../projects/sdk-config/sdk-config.service.js";
import { validateSchemaV1 } from "../../projects/sdk-config/validator.js";
import { SdkConfigRepository } from "./sdk-config.repository.js";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  hasMinRole,
  type CursorPaginationQuery,
  type RequestMeta,
} from "../types.js";
import type {
  SdkConfigDto,
  SdkConfigResolvedDto,
  SdkConfigRow,
  SdkConfigVersionDto,
  SdkConfigVersionRow,
} from "./sdk-config.types.js";

function assertStoredConfig(row: SdkConfigRow | SdkConfigVersionRow): void {
  validateSchemaV1(row.compiled_snapshot);
}

function toConfigDto(row: SdkConfigRow): SdkConfigDto {
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

function toVersionDto(row: SdkConfigVersionRow): SdkConfigVersionDto {
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

export interface UpdateConfigInput {
  editableConfig: Record<string, unknown>;
  changeSummary?: string;
}

/** Admin facade. Compilation, validation, hashing, and revision writes are delegated to the canonical service. */
export class SdkConfigService {
  constructor(
    private readonly repo: SdkConfigRepository,
    private readonly orgRepo: OrganizationRepository,
    private readonly auditService: OrganizationAuditService,
    private readonly canonical: RemoteSdkConfigService,
  ) {}

  private async requireAdmin(orgId: string, userId: string): Promise<void> {
    const member = await this.orgRepo.findActiveMember(orgId, userId);
    if (!member || !hasMinRole(member.role, "admin")) {
      throw new ForbiddenError("Requires organization admin role or higher");
    }
  }

  private async requireMember(orgId: string, userId: string): Promise<void> {
    if (!(await this.orgRepo.findActiveMember(orgId, userId))) {
      throw new ForbiddenError("Not a member of this organization");
    }
  }

  private scope(row: SdkConfigRow): ConfigScope {
    return {
      organizationId: row.organization_id,
      projectId: row.project_id,
      environmentId: row.environment_id,
      environmentKey: row.environment_slug,
    };
  }

  private async audit(
    meta: RequestMeta,
    orgId: string,
    projectId: string | null,
    action: string,
    entityId: string,
    newValues: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService.audit(meta, {
      orgId,
      projectId,
      action,
      entityType: "environment_sdk_config",
      entityId,
      newValues,
    });
  }

  async listConfigs(
    orgId: string,
    userId: string,
    filters: { projectId?: string; environmentId?: string },
    query: CursorPaginationQuery,
  ) {
    await this.requireMember(orgId, userId);
    const result = await this.repo.list(orgId, filters, query);
    return { data: result.data.map(toConfigDto), meta: result.meta };
  }

  async getConfig(orgId: string, userId: string, configId: string): Promise<SdkConfigDto> {
    await this.requireMember(orgId, userId);
    const row = await this.repo.findById(orgId, configId);
    if (!row) throw new NotFoundError("SDK config");
    return toConfigDto(row);
  }

  async updateConfig(meta: RequestMeta, orgId: string, configId: string, input: UpdateConfigInput): Promise<SdkConfigDto> {
    await this.requireAdmin(orgId, meta.actorUserId);
    return this.publish(meta, orgId, configId, input);
  }

  async updateProjectConfig(
    meta: RequestMeta,
    orgId: string,
    projectId: string,
    configId: string,
    input: UpdateConfigInput,
  ): Promise<SdkConfigDto> {
    await this.requireMember(orgId, meta.actorUserId);
    const current = await this.repo.findById(orgId, configId);
    if (!current || current.project_id !== projectId) throw new NotFoundError("SDK config");
    return this.publish(meta, orgId, configId, input, current);
  }

  private async publish(
    meta: RequestMeta,
    orgId: string,
    configId: string,
    input: UpdateConfigInput,
    loaded?: SdkConfigRow,
  ): Promise<SdkConfigDto> {
    const current = loaded ?? await this.repo.findById(orgId, configId);
    if (!current) throw new NotFoundError("SDK config");

    await this.canonical.publish(this.scope(current), {
      method: "PUT",
      body: { editableConfig: input.editableConfig },
      actorId: meta.actorUserId,
    });

    evictSdkConfigCache(current.environment_id);
    syncEnvironmentSdkConfigLookupToLogDbBestEffort(current.environment_id, "sdk_config.published");
    const row = await this.repo.findById(orgId, configId);
    if (!row) throw new NotFoundError("SDK config");
    await this.audit(meta, orgId, row.project_id, "sdk_config.published", configId, {
      environmentId: row.environment_id,
      revision: row.current_revision,
      revisionHash: row.current_hash,
      changeSummary: input.changeSummary ?? null,
    });
    return toConfigDto(row);
  }

  async rollbackConfig(
    meta: RequestMeta,
    orgId: string,
    configId: string,
    toRevision: number,
    reason: string,
  ): Promise<SdkConfigDto> {
    await this.requireAdmin(orgId, meta.actorUserId);
    const current = await this.repo.findById(orgId, configId);
    if (!current) throw new NotFoundError("SDK config");
    if (toRevision >= current.current_revision) {
      throw new ValidationError("Rollback target must be an earlier revision");
    }

    await this.canonical.rollback(this.scope(current), toRevision, meta.actorUserId);
    evictSdkConfigCache(current.environment_id);
    syncEnvironmentSdkConfigLookupToLogDbBestEffort(current.environment_id, "sdk_config.rolled_back");
    const row = await this.repo.findById(orgId, configId);
    if (!row) throw new NotFoundError("SDK config");
    await this.audit(meta, orgId, row.project_id, "sdk_config.rolled_back", configId, {
      environmentId: row.environment_id,
      revision: row.current_revision,
      rolledBackToRevision: toRevision,
      reason,
    });
    return toConfigDto(row);
  }

  async listVersions(orgId: string, userId: string, configId: string): Promise<SdkConfigVersionDto[]> {
    await this.getConfig(orgId, userId, configId);
    return (await this.repo.listVersions(configId)).map(toVersionDto);
  }

  async getVersion(orgId: string, userId: string, configId: string, revision: number): Promise<SdkConfigVersionDto> {
    await this.getConfig(orgId, userId, configId);
    const row = await this.repo.getVersion(configId, revision);
    if (!row) throw new NotFoundError(`Revision ${revision}`);
    return toVersionDto(row);
  }

  async resolveForSdk(orgId: string, userId: string, query: { environmentId: string }): Promise<SdkConfigResolvedDto> {
    await this.requireMember(orgId, userId);
    const key = sdkConfigCacheKey(query.environmentId);
    const cached = sdkConfigCache.get(key);
    if (cached) return cached;
    const resolved = await this.repo.resolveForEnvironment(orgId, query.environmentId);
    if (!resolved) throw new NotFoundError("SDK config");
    validateSchemaV1(resolved.compiledSnapshot);
    sdkConfigCache.set(key, resolved);
    return resolved;
  }
}

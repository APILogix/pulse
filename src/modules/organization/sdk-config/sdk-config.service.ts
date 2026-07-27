/** Business logic for environment-owned published SDK configuration. */
import { createHash } from "crypto";
import type { FastifyBaseLogger } from "fastify";
import { evictSdkConfigCache, sdkConfigCache, sdkConfigCacheKey } from "../../../config/lrucashe.js";
import type { OrganizationRepository } from "../repository.js";
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

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(",")}}`;
}

function configHash(value: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

function toConfigDto(row: SdkConfigRow): SdkConfigDto {
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

function toVersionDto(row: SdkConfigVersionRow): SdkConfigVersionDto {
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

export interface UpdateConfigInput {
  configValue: Record<string, unknown>;
  schemaVersion?: string | null;
  changeSummary?: string;
}
export class SdkConfigService {
  constructor(
    private readonly repo: SdkConfigRepository,
    private readonly orgRepo: OrganizationRepository,
    private readonly log: FastifyBaseLogger,
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

  private async audit(
    meta: RequestMeta,
    orgId: string,
    action: string,
    entityId: string,
    newValues: Record<string, unknown>,
  ): Promise<void> {
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
    } catch (error) {
      this.log.error({ err: error }, "SDK config audit write failed");
    }
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

  async updateConfig(
    meta: RequestMeta,
    orgId: string,
    configId: string,
    input: UpdateConfigInput,
  ): Promise<SdkConfigDto> {
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
    return this.publish(meta, orgId, configId, input);
  }
  private async publish(
    meta: RequestMeta,
    orgId: string,
    configId: string,
    input: UpdateConfigInput,
  ): Promise<SdkConfigDto> {
    const current = await this.repo.findById(orgId, configId);
    if (!current) throw new NotFoundError("SDK config");
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
    const target = await this.repo.getVersion(configId, toRevision);
    if (!target) throw new NotFoundError(`Revision ${toRevision}`);
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

  async listVersions(orgId: string, userId: string, configId: string): Promise<SdkConfigVersionDto[]> {
    await this.getConfig(orgId, userId, configId);
    return (await this.repo.listVersions(configId)).map(toVersionDto);
  }

  async getVersion(
    orgId: string,
    userId: string,
    configId: string,
    revision: number,
  ): Promise<SdkConfigVersionDto> {
    await this.getConfig(orgId, userId, configId);
    const row = await this.repo.getVersion(configId, revision);
    if (!row) throw new NotFoundError(`Revision ${revision}`);
    return toVersionDto(row);
  }
  async resolveForSdk(
    orgId: string,
    userId: string,
    query: { environmentId: string },
  ): Promise<SdkConfigResolvedDto> {
    await this.requireMember(orgId, userId);
    const key = sdkConfigCacheKey(query.environmentId);
    const cached = sdkConfigCache.get(key);
    if (cached) return cached;
    const resolved = await this.repo.resolveForEnvironment(orgId, query.environmentId);
    if (!resolved) throw new NotFoundError("SDK config");
    sdkConfigCache.set(key, resolved);
    return resolved;
  }
}

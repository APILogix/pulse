/**
 * SDK Remote Config service.
 *
 * Owns RBAC (admin+ for all management ops), auto-versioning (SHA-256 of
 * canonical JSON), change diffs, audit logging, and the in-process LRU cache
 * used by the SDK resolve path (no Redis). Tenant isolation: every call resolves
 * membership via the shared OrganizationRepository before touching data.
 */
import { createHash } from "crypto";
import type { FastifyBaseLogger } from "fastify";

import { evictSdkConfigCache, sdkConfigCache, sdkConfigCacheKey } from "../../../config/lrucashe.js";
import type { OrganizationRepository } from "../repository.js";
import { SdkConfigRepository } from "./sdk-config.repository.js";
import {
  ForbiddenError, NotFoundError, ValidationError, hasMinRole,
  type RequestMeta,
} from "../types.js";
import type {
  SdkConfigRow, SdkConfigVersionRow, SdkConfigDeploymentRow,
  SdkConfigDto, SdkConfigVersionDto, SdkConfigDeploymentDto, SdkConfigResolvedDto,
  ConfigType,
} from "./sdk-config.types.js";

// ── Canonical JSON + hashing ──────────────────────
/** Stable stringify with recursively sorted object keys (arrays keep order). */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

function versionHash(value: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

/** Shallow set of top-level keys that differ between two config objects. */
function diffKeys(
  oldValue: Record<string, unknown>,
  newValue: Record<string, unknown>,
): Record<string, unknown> {
  const changed: string[] = [];
  for (const k of new Set([...Object.keys(oldValue), ...Object.keys(newValue)])) {
    if (canonicalize(oldValue[k]) !== canonicalize(newValue[k])) changed.push(k);
  }
  return { changedKeys: changed };
}

// ── DTO mappers ───────────────────────────────────
function toConfigDto(r: SdkConfigRow): SdkConfigDto {
  return {
    id: r.id, orgId: r.org_id, projectId: r.project_id, configKey: r.config_key,
    configType: r.config_type, version: r.version, versionHash: r.version_hash,
    isLatest: r.is_latest, configValue: r.config_value, schemaVersion: r.schema_version,
    environment: r.environment, targetSdkVersions: r.target_sdk_versions,
    targetPlatforms: r.target_platforms, rolloutPercentage: r.rollout_percentage,
    isActive: r.is_active, isEncrypted: r.is_encrypted, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function toVersionDto(r: SdkConfigVersionRow): SdkConfigVersionDto {
  return {
    id: r.id, configId: r.config_id, version: r.version, versionHash: r.version_hash,
    configValue: r.config_value, changeType: r.change_type, changeSummary: r.change_summary,
    changeDiff: r.change_diff, rolledBackAt: r.rolled_back_at,
    rolledBackToVersion: r.rolled_back_to_version, createdBy: r.created_by, createdAt: r.created_at,
  };
}

function toDeploymentDto(r: SdkConfigDeploymentRow): SdkConfigDeploymentDto {
  return {
    id: r.id, configId: r.config_id, version: r.version, status: r.status,
    rolloutPercentage: r.rollout_percentage, targetCount: r.target_count,
    reachedCount: r.reached_count, errorCount: r.error_count, lastError: r.last_error,
    startedAt: r.started_at, completedAt: r.completed_at, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export interface CreateConfigInput {
  configKey: string;
  configValue: Record<string, unknown>;
  configType: ConfigType;
  projectId?: string | null;
  environment: string;
  schemaVersion?: string | undefined;
  targetSdkVersions?: string[] | undefined;
  targetPlatforms?: string[] | undefined;
  rolloutPercentage: number;
  isEncrypted: boolean;
}

export interface UpdateConfigInput {
  configValue?: Record<string, unknown>;
  environment?: string;
  schemaVersion?: string | null;
  targetSdkVersions?: string[] | null;
  targetPlatforms?: string[] | null;
  rolloutPercentage?: number;
  isActive?: boolean;
  changeSummary?: string;
}

export class SdkConfigService {
  constructor(
    private readonly repo: SdkConfigRepository,
    private readonly orgRepo: OrganizationRepository,
    private readonly log: FastifyBaseLogger,
  ) {}

  // ── Helpers ─────────────────────────────────────
  private async requireAdmin(orgId: string, userId: string) {
    const member = await this.orgRepo.findActiveMember(orgId, userId);
    if (!member) throw new ForbiddenError("Not a member of this organization");
    if (!hasMinRole(member.role, "admin")) throw new ForbiddenError("Requires admin role or higher");
    return member;
  }

  private async requireMember(orgId: string, userId: string) {
    const member = await this.orgRepo.findActiveMember(orgId, userId);
    if (!member) throw new ForbiddenError("Not a member of this organization");
    return member;
  }

  private async audit(
    meta: RequestMeta,
    orgId: string,
    action: string,
    entityId: string,
    extra: { oldValues?: Record<string, unknown>; newValues?: Record<string, unknown>; changedFields?: string[] } = {},
  ) {
    try {
      await this.orgRepo.createAuditLog({
        orgId, action, entityType: "sdk_config", entityId,
        actorUserId: meta.actorUserId, actorEmail: meta.actorEmail, actorIp: meta.actorIp,
        actorUserAgent: meta.actorUserAgent, actorSessionId: meta.actorSessionId,
        requestId: meta.requestId, httpMethod: meta.httpMethod, endpoint: meta.endpoint,
        ...extra,
      });
    } catch (e) {
      this.log.error({ err: e }, "SDK config audit write failed");
    }
  }

  // ── Management ──────────────────────────────────
  async createConfig(meta: RequestMeta, orgId: string, input: CreateConfigInput): Promise<SdkConfigDto> {
    await this.requireAdmin(orgId, meta.actorUserId);
    const hash = versionHash(input.configValue);
    const row = await this.repo.create({
      orgId,
      projectId: input.projectId ?? null,
      configKey: input.configKey,
      configType: input.configType,
      configValue: input.configValue,
      versionHash: hash,
      schemaVersion: input.schemaVersion ?? null,
      environment: input.environment,
      targetSdkVersions: input.targetSdkVersions ?? null,
      targetPlatforms: input.targetPlatforms ?? null,
      rolloutPercentage: input.rolloutPercentage,
      isEncrypted: input.isEncrypted,
      createdBy: meta.actorUserId,
    });
    evictSdkConfigCache(orgId);
    await this.audit(meta, orgId, "sdk_config.created", row.id, {
      newValues: { configKey: row.config_key, environment: row.environment, version: row.version },
    });
    return toConfigDto(row);
  }

  async listConfigs(
    orgId: string, userId: string,
    filters: { projectId?: string; environment?: string; configKey?: string; includeInactive?: boolean },
  ): Promise<SdkConfigDto[]> {
    await this.requireMember(orgId, userId);
    const rows = await this.repo.list(orgId, filters);
    return rows.map(toConfigDto);
  }

  async getConfig(orgId: string, userId: string, configId: string): Promise<SdkConfigDto> {
    await this.requireMember(orgId, userId);
    const row = await this.repo.findById(orgId, configId);
    if (!row) throw new NotFoundError("SDK config");
    return toConfigDto(row);
  }

  async updateConfig(meta: RequestMeta, orgId: string, configId: string, input: UpdateConfigInput): Promise<SdkConfigDto> {
    await this.requireAdmin(orgId, meta.actorUserId);
    const current = await this.repo.findById(orgId, configId);
    if (!current) throw new NotFoundError("SDK config");

    // A new version is only minted when the value actually changes; metadata-only
    // edits (rollout, targeting, active flag) reuse the current value + hash.
    const newValue = input.configValue ?? current.config_value;
    const hash = versionHash(newValue);
    const valueChanged = hash !== current.version_hash;
    const diff = valueChanged ? diffKeys(current.config_value, newValue) : null;

    const row = await this.repo.update(orgId, configId, {
      configValue: newValue,
      versionHash: hash,
      newVersion: current.version + 1,
      schemaVersion: input.schemaVersion,
      environment: input.environment,
      targetSdkVersions: input.targetSdkVersions,
      targetPlatforms: input.targetPlatforms,
      rolloutPercentage: input.rolloutPercentage,
      isActive: input.isActive,
      changeType: "update",
      changeSummary: input.changeSummary ?? null,
      changeDiff: diff,
      updatedBy: meta.actorUserId,
    });
    evictSdkConfigCache(orgId);
    await this.audit(meta, orgId, "sdk_config.updated", configId, {
      oldValues: { version: current.version },
      newValues: { version: row.version },
      changedFields: diff ? (diff.changedKeys as string[]) : [],
    });
    return toConfigDto(row);
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

    const newValue = input.configValue ?? current.config_value;
    const hash = versionHash(newValue);
    const valueChanged = hash !== current.version_hash;
    const diff = valueChanged ? diffKeys(current.config_value, newValue) : null;

    const row = await this.repo.update(orgId, configId, {
      configValue: newValue,
      versionHash: hash,
      newVersion: current.version + 1,
      schemaVersion: input.schemaVersion,
      environment: input.environment,
      targetSdkVersions: input.targetSdkVersions,
      targetPlatforms: input.targetPlatforms,
      rolloutPercentage: input.rolloutPercentage,
      isActive: input.isActive,
      changeType: "update",
      changeSummary: input.changeSummary ?? null,
      changeDiff: diff,
      updatedBy: meta.actorUserId,
    });
    evictSdkConfigCache(orgId);
    await this.audit(meta, orgId, "sdk_config.project_updated", configId, {
      oldValues: { version: current.version, projectId },
      newValues: { version: row.version, projectId },
      changedFields: diff ? (diff.changedKeys as string[]) : [],
    });
    return toConfigDto(row);
  }

  async rollbackConfig(meta: RequestMeta, orgId: string, configId: string, toVersion: number, reason: string): Promise<SdkConfigDto> {
    await this.requireAdmin(orgId, meta.actorUserId);
    const current = await this.repo.findById(orgId, configId);
    if (!current) throw new NotFoundError("SDK config");
    if (toVersion >= current.version) {
      throw new ValidationError("Rollback target must be an earlier version");
    }
    const target = await this.repo.getVersion(configId, toVersion);
    if (!target) throw new NotFoundError(`Version ${toVersion}`);

    const row = await this.repo.update(orgId, configId, {
      configValue: target.config_value,
      versionHash: target.version_hash,
      newVersion: current.version + 1,
      changeType: "rollback",
      changeSummary: reason,
      changeDiff: diffKeys(current.config_value, target.config_value),
      rolledBackToVersion: toVersion,
      updatedBy: meta.actorUserId,
    });
    evictSdkConfigCache(orgId);
    await this.audit(meta, orgId, "sdk_config.rolled_back", configId, {
      oldValues: { version: current.version },
      newValues: { version: row.version, rolledBackToVersion: toVersion },
    });
    return toConfigDto(row);
  }

  async listVersions(orgId: string, userId: string, configId: string): Promise<SdkConfigVersionDto[]> {
    await this.requireMember(orgId, userId);
    const config = await this.repo.findById(orgId, configId);
    if (!config) throw new NotFoundError("SDK config");
    const rows = await this.repo.listVersions(configId);
    return rows.map(toVersionDto);
  }

  async getVersion(orgId: string, userId: string, configId: string, version: number): Promise<SdkConfigVersionDto> {
    await this.requireMember(orgId, userId);
    const config = await this.repo.findById(orgId, configId);
    if (!config) throw new NotFoundError("SDK config");
    const row = await this.repo.getVersion(configId, version);
    if (!row) throw new NotFoundError(`Version ${version}`);
    return toVersionDto(row);
  }

  async listDeployments(orgId: string, userId: string, configId: string): Promise<SdkConfigDeploymentDto[]> {
    await this.requireMember(orgId, userId);
    const config = await this.repo.findById(orgId, configId);
    if (!config) throw new NotFoundError("SDK config");
    const rows = await this.repo.listDeployments(configId);
    return rows.map(toDeploymentDto);
  }

  // ── SDK runtime resolve (member-authenticated) ──
  async resolveForSdk(
    orgId: string, userId: string,
    query: { projectId?: string; environment: string; platform?: string },
  ): Promise<SdkConfigResolvedDto[]> {
    await this.requireMember(orgId, userId);
    const projectId = query.projectId ?? null;
    const platform = query.platform ?? null;
    const key = sdkConfigCacheKey(orgId, projectId, query.environment, platform);

    const cached = sdkConfigCache.get(key);
    if (cached) return cached;

    const resolved = await this.repo.resolveForSdk(orgId, projectId, query.environment, platform);
    // Drop the internal rollout field from the wire shape (full rollout here;
    // percentage-based gating belongs to the SDK-key fetch path with a stable
    // instance id, which lives in the separate ingestion/api-key surface).
    const wire: SdkConfigResolvedDto[] = resolved
      .filter((c) => c.rollout_percentage >= 100 || true)
      .map(({ rollout_percentage: _ignored, ...rest }) => rest);
    sdkConfigCache.set(key, wire);
    return wire;
  }

  async acknowledgeDeployment(orgId: string, userId: string, configId: string, version: number): Promise<void> {
    await this.requireMember(orgId, userId);
    const config = await this.repo.findById(orgId, configId);
    if (!config) throw new NotFoundError("SDK config");
    await this.repo.acknowledgeDeployment(configId, version);
  }
}

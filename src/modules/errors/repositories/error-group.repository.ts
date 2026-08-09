import type { Pool, PoolClient } from 'pg';
import type { ErrorGroup, ErrorGroupStatus, CreateErrorGroupParams } from '../models/error-group.model.js';
import {
  isReleaseEligible,
  normalizeSeverity,
  severityRank,
} from '../fingerprint.js';

export interface SnapshotParams {
  message?: string;
  errorName?: string;
  statusCode?: number;
  traceId?: string;
  requestId?: string;
}

export type UpsertErrorGroupParams = CreateErrorGroupParams & SnapshotParams;

export interface GroupMutationResult {
  id: string;
  isNew: boolean;
  status: ErrorGroupStatus;
  isRegression: boolean;
  regressionCount?: number;
}

type GroupRow = Record<string, any>;

export class ErrorGroupRepository {
  constructor(private readonly pool: Pool) {}

  async upsertGroup(client: PoolClient, params: UpsertErrorGroupParams): Promise<GroupMutationResult> {
    const organizationId = params.organizationId;
    if (!organizationId) throw new Error('ORGANIZATION_ID_REQUIRED');

    const occurredAt = params.occurredAt ?? new Date();
    const severity = normalizeSeverity(params.severity);
    const created = await client.query<GroupRow>(
      `INSERT INTO error_groups (
         organization_id, project_id, fingerprint, fingerprint_version, status,
         occurrence_count, first_seen_at, last_seen_at, latest_event_occurred_at,
         first_event_id, latest_event_id, highest_severity, latest_severity,
         latest_release, latest_sdk_version, latest_application_version,
         latest_environment, latest_service, last_error_message, last_error_name,
         last_status_code, last_trace_id, last_request_id, version
       ) VALUES (
         $1, $2, $3, $4, 'OPEN', 1, $5, $5, $5,
         $6, $6, $7, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 1
       )
       ON CONFLICT (project_id, fingerprint) DO NOTHING
       RETURNING *`,
      [
        organizationId,
        params.projectId,
        params.fingerprint,
        params.fingerprintVersion ?? 2,
        occurredAt,
        params.eventId,
        severity,
        params.release ?? null,
        params.sdkVersion ?? null,
        params.applicationVersion ?? null,
        params.environment ?? null,
        params.service ?? null,
        params.message ?? null,
        params.errorName ?? null,
        params.statusCode ?? null,
        params.traceId ?? null,
        params.requestId ?? null,
      ],
    );

    if (created.rows[0]) {
      const group = created.rows[0];
      await this.insertHistory(client, {
        groupId: group.id,
        action: 'CREATED',
        previousStatus: null,
        newStatus: 'OPEN',
        eventId: params.eventId,
        release: params.release ?? null,
        occurredAt,
        reason: 'first_event',
      });
      return {
        id: group.id,
        isNew: true,
        status: 'OPEN',
        isRegression: false,
        regressionCount: 0,
      };
    }

    const source = await this.lockByFingerprint(client, params.projectId, params.fingerprint);
    if (!source) throw new Error('ERROR_GROUP_NOT_FOUND_AFTER_CONFLICT');

    const target = await this.resolveEffectiveGroup(client, source);
    const sourceIsRedirect = source.id !== target.id;
    if (sourceIsRedirect) {
      return this.updateExistingGroup(client, target, params, occurredAt, severity, true);
    }
    return this.updateExistingGroup(client, target, params, occurredAt, severity, false);
  }

  private async updateExistingGroup(
    client: PoolClient,
    group: GroupRow,
    params: UpsertErrorGroupParams,
    occurredAt: Date,
    severity: string,
    mergedRedirect: boolean,
  ): Promise<GroupMutationResult> {
    const currentStatus = String(group.status).toUpperCase() as ErrorGroupStatus;
    const currentOccurredAt = group.latest_event_occurred_at ?? group.last_seen_at ?? group.created_at;
    const isNewer = this.isNewer(occurredAt, params.eventId, currentOccurredAt, group.latest_event_id);
    const regression = !mergedRedirect
      && currentStatus === 'RESOLVED'
      && group.resolved_at instanceof Date
      && occurredAt > group.resolved_at
      && isReleaseEligible(params.release, group.resolved_release);
    const nextStatus: ErrorGroupStatus = regression ? 'OPEN' : currentStatus;
    const nextHighest = severityRank(severity) > severityRank(group.highest_severity)
      ? severity
      : normalizeSeverity(group.highest_severity);
    const nextRegressionCount = Number(group.regression_count ?? 0) + (regression ? 1 : 0);

    await client.query(
      `UPDATE error_groups
          SET status = $1,
              occurrence_count = occurrence_count + 1,
              first_seen_at = LEAST(first_seen_at, $2),
              last_seen_at = GREATEST(last_seen_at, $2),
              latest_event_occurred_at = CASE WHEN $3 THEN $2 ELSE latest_event_occurred_at END,
              latest_event_id = CASE WHEN $3 THEN $4 ELSE latest_event_id END,
              latest_severity = CASE WHEN $3 THEN $5 ELSE latest_severity END,
              highest_severity = $6,
              latest_release = CASE WHEN $3 THEN $7 ELSE latest_release END,
              latest_sdk_version = CASE WHEN $3 THEN $8 ELSE latest_sdk_version END,
              latest_application_version = CASE WHEN $3 THEN $9 ELSE latest_application_version END,
              latest_environment = CASE WHEN $3 THEN $10 ELSE latest_environment END,
              latest_service = CASE WHEN $3 THEN $11 ELSE latest_service END,
              last_error_message = CASE WHEN $3 THEN $12 ELSE last_error_message END,
              last_error_name = CASE WHEN $3 THEN $13 ELSE last_error_name END,
              last_status_code = CASE WHEN $3 THEN $14 ELSE last_status_code END,
              last_trace_id = CASE WHEN $3 THEN $15 ELSE last_trace_id END,
              last_request_id = CASE WHEN $3 THEN $16 ELSE last_request_id END,
              is_regression = CASE WHEN $17 THEN TRUE ELSE FALSE END,
              regression_count = $18,
              last_regressed_at = CASE WHEN $17 THEN $2 ELSE last_regressed_at END,
              resolved_at = CASE WHEN $17 THEN NULL ELSE resolved_at END,
              resolved_release = CASE WHEN $17 THEN NULL ELSE resolved_release END,
              version = version + 1,
              updated_at = NOW()
        WHERE id = $19 AND project_id = $20`,
      [
        nextStatus,
        occurredAt,
        isNewer,
        params.eventId,
        severity,
        nextHighest,
        params.release ?? null,
        params.sdkVersion ?? null,
        params.applicationVersion ?? null,
        params.environment ?? null,
        params.service ?? null,
        params.message ?? null,
        params.errorName ?? null,
        params.statusCode ?? null,
        params.traceId ?? null,
        params.requestId ?? null,
        regression,
        nextRegressionCount,
        group.id,
        params.projectId,
      ],
    );

    if (regression) {
      await this.insertHistory(client, {
        groupId: group.id,
        action: 'REGRESSED',
        previousStatus: 'RESOLVED',
        newStatus: 'OPEN',
        eventId: params.eventId,
        release: params.release ?? null,
        occurredAt,
        reason: 'qualifying_event_after_resolution',
      });
      await this.insertRegressionOutbox(client, group, params, occurredAt, severity, nextRegressionCount);
    }

    return {
      id: group.id,
      isNew: false,
      status: nextStatus,
      isRegression: regression,
      regressionCount: nextRegressionCount,
    };
  }

  private async lockByFingerprint(client: PoolClient, projectId: string, fingerprint: string): Promise<GroupRow | null> {
    const result = await client.query<GroupRow>(
      `SELECT * FROM error_groups
        WHERE project_id = $1 AND fingerprint = $2
        FOR UPDATE`,
      [projectId, fingerprint],
    );
    return result.rows[0] ?? null;
  }

  private async resolveEffectiveGroup(client: PoolClient, source: GroupRow): Promise<GroupRow> {
    let current = source;
    const visited = new Set<string>();
    while (current.merged_into) {
      if (visited.has(current.id)) throw new Error('ERROR_GROUP_MERGE_CYCLE');
      visited.add(current.id);
      const result = await client.query<GroupRow>(
        `SELECT * FROM error_groups WHERE id = $1 FOR UPDATE`,
        [current.merged_into],
      );
      if (!result.rows[0]) throw new Error('ERROR_GROUP_MERGE_TARGET_NOT_FOUND');
      current = result.rows[0];
    }
    return current;
  }

  private isNewer(incomingAt: Date, incomingId: string, currentAt: Date, currentId: string): boolean {
    return incomingAt > currentAt || (incomingAt.getTime() === currentAt.getTime() && incomingId > currentId);
  }

  private async insertHistory(
    client: PoolClient,
    params: {
      groupId: string;
      action: string;
      previousStatus: string | null;
      newStatus: string | null;
      eventId: string | null;
      release: string | null;
      occurredAt: Date | null;
      reason: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO error_group_history (
         group_id, action, previous_status, new_status, event_id, release,
         occurred_at, reason, actor_type, old_value, new_value, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'system', $9, $10, '{}'::jsonb)`,
      [
        params.groupId,
        params.action,
        params.previousStatus,
        params.newStatus,
        params.eventId,
        params.release,
        params.occurredAt,
        params.reason,
        params.previousStatus ? JSON.stringify({ status: params.previousStatus }) : null,
        params.newStatus ? JSON.stringify({ status: params.newStatus }) : null,
      ],
    );
  }

  private async insertRegressionOutbox(
    client: PoolClient,
    group: GroupRow,
    params: UpsertErrorGroupParams,
    occurredAt: Date,
    severity: string,
    regressionCount: number,
  ): Promise<void> {
    const attributes = {
      schemaVersion: 1,
      eventType: 'ErrorGroupRegressed',
      errorGroupId: group.id,
      organizationId: group.organization_id,
      projectId: group.project_id,
      fingerprint: group.fingerprint,
      eventId: params.eventId,
      occurredAt: occurredAt.toISOString(),
      previousStatus: 'RESOLVED',
      newStatus: 'OPEN',
      release: params.release ?? null,
      severity,
      regressionCount,
    };
    const idempotencyKey = `error_group_regressed:${group.id}:${params.eventId}`;
    const reserved = await client.query(
      `INSERT INTO alert_runtime_idempotency_keys (namespace, organization_id, idempotency_key)
       VALUES ('error_group_regressed', $1, $2)
       ON CONFLICT DO NOTHING
       RETURNING idempotency_key`,
      [group.organization_id, idempotencyKey],
    );
    if (reserved.rowCount === 0) return;

    await client.query(
      `INSERT INTO telemetry_outbox (
         organization_id, project_id, environment, signal_kind, event_id,
         severity, fast_path, attributes, occurred_at
       ) VALUES ($1, $2, $3, 'error_group_regressed', $4, $5, TRUE, $6::jsonb, $7)
       ON CONFLICT DO NOTHING`,
      [
        group.organization_id,
        group.project_id,
        params.environment ?? group.latest_environment ?? null,
        params.eventId,
        severity,
        JSON.stringify(attributes),
        occurredAt,
      ],
    );
  }

  async findByFingerprint(projectId: string, fingerprint: string): Promise<ErrorGroup | null> {
    const result = await this.pool.query(
      `SELECT * FROM error_groups WHERE project_id = $1 AND fingerprint = $2`,
      [projectId, fingerprint],
    );
    return result.rows[0] ? this.mapToDomain(result.rows[0]) : null;
  }

  async resolve(client: PoolClient, projectId: string, id: string, release?: string | null): Promise<void> {
    await client.query(
      `UPDATE error_groups
          SET status = 'RESOLVED', resolved_at = NOW(), resolved_release = COALESCE($3, latest_release),
              version = version + 1, updated_at = NOW()
        WHERE project_id = $1 AND id = $2`,
      [projectId, id, release ?? null],
    );
  }

  async ignore(client: PoolClient, projectId: string, id: string): Promise<void> {
    await this.updateStatus(client, projectId, id, 'IGNORED');
  }

  async reopen(client: PoolClient, projectId: string, id: string): Promise<void> {
    await this.updateStatus(client, projectId, id, 'OPEN');
  }

  async archive(client: PoolClient, projectId: string, id: string): Promise<void> {
    await this.updateStatus(client, projectId, id, 'ARCHIVED');
  }

  private async updateStatus(client: PoolClient, projectId: string, id: string, status: ErrorGroupStatus): Promise<void> {
    await client.query(
      `UPDATE error_groups
          SET status = $3,
              resolved_at = CASE WHEN $3 = 'RESOLVED' THEN resolved_at ELSE NULL END,
              resolved_release = CASE WHEN $3 = 'RESOLVED' THEN resolved_release ELSE NULL END,
              version = version + 1, updated_at = NOW()
        WHERE project_id = $1 AND id = $2`,
      [projectId, id, status],
    );
  }

  async assign(_client: PoolClient, _projectId: string, _id: string, _userId: string): Promise<void> {}

  private mapToDomain(row: GroupRow): ErrorGroup {
    return {
      id: row.id,
      publicId: row.public_id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      fingerprint: row.fingerprint,
      fingerprintVersion: Number(row.fingerprint_version ?? 1),
      status: String(row.status).toUpperCase() as ErrorGroupStatus,
      occurrenceCount: Number(row.occurrence_count),
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      firstEventId: row.first_event_id,
      latestEventId: row.latest_event_id,
      latestEventOccurredAt: row.latest_event_occurred_at,
      highestSeverity: normalizeSeverity(row.highest_severity),
      latestSeverity: normalizeSeverity(row.latest_severity),
      regressionCount: Number(row.regression_count ?? 0),
      lastRegressedAt: row.last_regressed_at,
      latestRelease: row.latest_release,
      latestSdkVersion: row.latest_sdk_version,
      latestApplicationVersion: row.latest_application_version,
      latestEnvironment: row.latest_environment,
      latestService: row.latest_service,
      resolvedAt: row.resolved_at,
      resolvedRelease: row.resolved_release,
      lastErrorMessage: row.last_error_message,
      lastErrorName: row.last_error_name,
      lastStatusCode: row.last_status_code,
      lastTraceId: row.last_trace_id,
      lastRequestId: row.last_request_id,
      mergedInto: row.merged_into,
      isMerged: Boolean(row.is_merged),
      version: Number(row.version),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

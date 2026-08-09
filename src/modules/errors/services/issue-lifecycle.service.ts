import type { Pool, PoolClient } from 'pg';
import { domainEventBus } from '../../../shared/events/domain-event-bus.js';
import type { ErrorGroupRepository } from '../repositories/error-group.repository.js';
import type { ErrorGroupHistoryRepository } from '../repositories/error-group-history.repository.js';
import type { ErrorGroupStatus } from '../models/error-group.model.js';

export class InvalidTransitionError extends Error {
  constructor(public readonly transition: string) {
    super(`Invalid lifecycle transition: ${transition}`);
    this.name = 'InvalidTransitionError';
  }
}

export class LifecycleConflictError extends Error {
  constructor(message = 'Error group was modified by another request') {
    super(message);
    this.name = 'LifecycleConflictError';
  }
}

export interface LifecycleOptions {
  actorId?: string;
  reason?: string;
  release?: string | null;
  expectedVersion?: number;
}

type LifecycleInput = LifecycleOptions | string | undefined;

function optionsOf(value: LifecycleInput): LifecycleOptions {
  return typeof value === 'string' ? { actorId: value } : value ?? {};
}

export class IssueLifecycleService {
  constructor(
    private readonly pool: Pool,
    private readonly errorGroupRepo: ErrorGroupRepository,
    private readonly historyRepo: ErrorGroupHistoryRepository,
  ) {}

  resolve(projectId: string, id: string, options?: LifecycleInput): Promise<void> {
    return this.executeTransition(projectId, id, 'RESOLVED', optionsOf(options));
  }

  ignore(projectId: string, id: string, options?: LifecycleInput): Promise<void> {
    return this.executeTransition(projectId, id, 'IGNORED', optionsOf(options));
  }

  reopen(projectId: string, id: string, options?: LifecycleInput): Promise<void> {
    return this.executeTransition(projectId, id, 'OPEN', optionsOf(options));
  }

  open(projectId: string, id: string, options?: LifecycleInput): Promise<void> {
    return this.reopen(projectId, id, options);
  }

  restore(projectId: string, id: string, options?: LifecycleInput): Promise<void> {
    return this.reopen(projectId, id, options);
  }

  archive(projectId: string, id: string, options?: LifecycleInput): Promise<void> {
    return this.executeTransition(projectId, id, 'ARCHIVED', optionsOf(options));
  }

  async merge(projectId: string, sourceId: string, targetId: string, input?: LifecycleInput): Promise<void> {
    const options = optionsOf(input);
    if (sourceId === targetId) throw new LifecycleConflictError('Cannot merge a group into itself');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<{
        id: string;
        project_id: string;
        organization_id: string;
        status: ErrorGroupStatus;
        occurrence_count: string | number;
        merged_into: string | null;
        is_merged: boolean;
        version: number;
      }>(
        `SELECT id, project_id, organization_id, status, occurrence_count, merged_into, is_merged, version
           FROM error_groups
          WHERE project_id = $1 AND id = ANY($2::uuid[])
          ORDER BY id
          FOR UPDATE`,
        [projectId, [sourceId, targetId]],
      );
      if (locked.rows.length !== 2) throw new Error('GROUP_NOT_FOUND');
      const source = locked.rows.find((row) => row.id === sourceId)!;
      const target = locked.rows.find((row) => row.id === targetId)!;
      if (source.merged_into === targetId) {
        await client.query('COMMIT');
        return;
      }
      if (source.merged_into || source.is_merged) throw new LifecycleConflictError('Source group is already merged');
      if (target.merged_into || target.is_merged) throw new LifecycleConflictError('Target group is already merged');
      if (options.expectedVersion !== undefined && Number(source.version) !== options.expectedVersion) {
        throw new LifecycleConflictError();
      }

      await client.query(
        `UPDATE error_groups
            SET is_merged = TRUE, merged_into = $1, status = 'ARCHIVED', version = version + 1, updated_at = NOW()
          WHERE id = $2 AND project_id = $3`,
        [targetId, sourceId, projectId],
      );
      await client.query(
        `UPDATE error_groups
            SET occurrence_count = occurrence_count + $1, version = version + 1, updated_at = NOW()
          WHERE id = $2 AND project_id = $3`,
        [Number(source.occurrence_count), targetId, projectId],
      );
      await client.query(
        `UPDATE events_errors SET error_group_id = $1
          WHERE project_id = $2 AND error_group_id = $3`,
        [targetId, projectId, sourceId],
      );

      await this.historyRepo.insertHistory(client, {
        groupId: sourceId,
        action: 'MERGED',
        previousStatus: String(source.status).toUpperCase(),
        newStatus: 'ARCHIVED',
        actorId: options.actorId ?? null,
        actorType: options.actorId ? 'user' : 'system',
        reason: options.reason ?? 'manual_merge',
        sourceGroupId: sourceId,
        targetGroupId: targetId,
        oldValue: { status: source.status },
        newValue: { status: 'ARCHIVED', mergedInto: targetId },
      });
      await this.historyRepo.insertHistory(client, {
        groupId: targetId,
        action: 'MERGE_RECEIVED',
        previousStatus: String(target.status).toUpperCase(),
        newStatus: String(target.status).toUpperCase(),
        actorId: options.actorId ?? null,
        actorType: options.actorId ? 'user' : 'system',
        reason: options.reason ?? 'manual_merge',
        sourceGroupId: sourceId,
        targetGroupId: targetId,
        metadata: { mergedOccurrences: Number(source.occurrence_count) },
      });
      await client.query('COMMIT');
    } catch (error) {
      await Promise.resolve(client.query('ROLLBACK')).catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async unmerge(projectId: string, sourceId: string, input?: LifecycleInput): Promise<void> {
    const options = optionsOf(input);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{
        id: string;
        status: ErrorGroupStatus;
        merged_into: string | null;
        is_merged: boolean;
        version: number;
      }>(
        `SELECT id, status, merged_into, is_merged FROM error_groups
          WHERE project_id = $1 AND id = $2 FOR UPDATE`,
        [projectId, sourceId],
      );
      const source = result.rows[0];
      if (!source) throw new Error('GROUP_NOT_FOUND');
      if (!source.is_merged || !source.merged_into) throw new LifecycleConflictError('Group is not merged');
      if (options.expectedVersion !== undefined && Number(source.version) !== options.expectedVersion) {
        throw new LifecycleConflictError();
      }

      await client.query(
        `UPDATE error_groups
            SET is_merged = FALSE, merged_into = NULL, status = 'OPEN', version = version + 1, updated_at = NOW()
          WHERE project_id = $1 AND id = $2`,
        [projectId, sourceId],
      );
      await this.historyRepo.insertHistory(client, {
        groupId: sourceId,
        action: 'UNMERGED',
        previousStatus: String(source.status).toUpperCase(),
        newStatus: 'OPEN',
        actorId: options.actorId ?? null,
        actorType: options.actorId ? 'user' : 'system',
        reason: options.reason ?? 'manual_unmerge',
        sourceGroupId: sourceId,
        targetGroupId: source.merged_into,
        oldValue: { status: source.status, mergedInto: source.merged_into },
        newValue: { status: 'OPEN', mergedInto: null },
      });
      await client.query('COMMIT');
    } catch (error) {
      await Promise.resolve(client.query('ROLLBACK')).catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async executeTransition(
    projectId: string,
    id: string,
    targetStatus: ErrorGroupStatus,
    options: LifecycleOptions,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ status: ErrorGroupStatus; version: number }>(
        `SELECT status, version FROM error_groups WHERE project_id = $1 AND id = $2 FOR UPDATE`,
        [projectId, id],
      );
      const current = result.rows[0];
      if (!current) throw new Error('GROUP_NOT_FOUND');
      if (options.expectedVersion !== undefined && Number(current.version) !== options.expectedVersion) {
        throw new LifecycleConflictError();
      }

      const currentStatus = String(current.status).toUpperCase() as ErrorGroupStatus;
      this.validateTransition(currentStatus, targetStatus);
      if (targetStatus === 'RESOLVED') {
        if (options.release !== undefined) await this.errorGroupRepo.resolve(client, projectId, id, options.release);
        else await this.errorGroupRepo.resolve(client, projectId, id);
      }
      else if (targetStatus === 'IGNORED') await this.errorGroupRepo.ignore(client, projectId, id);
      else if (targetStatus === 'ARCHIVED') await this.errorGroupRepo.archive(client, projectId, id);
      else await this.errorGroupRepo.reopen(client, projectId, id);

      await this.historyRepo.insertHistory(client, {
        groupId: id,
        action: 'STATUS_CHANGED',
        previousStatus: currentStatus,
        newStatus: targetStatus,
        actorId: options.actorId ?? null,
        actorType: options.actorId ? 'user' : 'system',
        release: options.release ?? null,
        reason: options.reason ?? 'manual_transition',
        oldValue: { status: currentStatus },
        newValue: { status: targetStatus },
      });
      await client.query('COMMIT');

      const payload = { projectId, groupId: id, ...(options.actorId ? { actorId: options.actorId } : {}) };
      if (targetStatus === 'RESOLVED') domainEventBus.publish('ErrorResolved', payload);
      else if (targetStatus === 'IGNORED') domainEventBus.publish('ErrorIgnored', payload);
      else if (targetStatus === 'ARCHIVED') domainEventBus.publish('ErrorArchived', payload);
      else if (currentStatus === 'ARCHIVED') domainEventBus.publish('ErrorRestored', payload);
      else domainEventBus.publish('ErrorReopened', payload);
    } catch (error) {
      await Promise.resolve(client.query('ROLLBACK')).catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private validateTransition(from: ErrorGroupStatus, to: ErrorGroupStatus): void {
    const valid: Record<ErrorGroupStatus, ErrorGroupStatus[]> = {
      OPEN: ['RESOLVED', 'IGNORED', 'ARCHIVED'],
      RESOLVED: [],
      IGNORED: ['OPEN'],
      ARCHIVED: ['OPEN'],
    };
    if (!valid[from].includes(to)) throw new InvalidTransitionError(`${from} -> ${to}`);
  }
}

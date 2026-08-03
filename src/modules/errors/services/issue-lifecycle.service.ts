import type { Pool, PoolClient } from 'pg';
import type { ErrorGroupHistoryRepository } from '../repositories/error-group-history.repository.js';
import { domainEventBus } from '../../../shared/events/domain-event-bus.js';
import type { ErrorGroupRepository } from '../repositories/error-group.repository.js';

export class InvalidTransitionError extends Error {
  constructor(public readonly transition: string) {
    super(`Invalid lifecycle transition: ${transition}`);
  }
}

export class IssueLifecycleService {
  constructor(
    private readonly pool: Pool,
    private readonly errorGroupRepo: ErrorGroupRepository,
    private readonly historyRepo: ErrorGroupHistoryRepository
  ) {}

  async resolve(projectId: string, id: string, actorId?: string): Promise<void> {
    await this.executeTransition(projectId, id, 'RESOLVED', actorId);
  }

  async ignore(projectId: string, id: string, actorId?: string): Promise<void> {
    await this.executeTransition(projectId, id, 'IGNORED', actorId);
  }

  async reopen(projectId: string, id: string, actorId?: string): Promise<void> {
    await this.executeTransition(projectId, id, 'OPEN', actorId);
  }

  async open(projectId: string, id: string, actorId?: string): Promise<void> {
    await this.executeTransition(projectId, id, 'OPEN', actorId);
  }
  
  async archive(projectId: string, id: string, actorId?: string): Promise<void> {
    await this.executeTransition(projectId, id, 'ARCHIVED', actorId);
  }

  async restore(projectId: string, id: string, actorId?: string): Promise<void> {
    await this.executeTransition(projectId, id, 'OPEN', actorId);
  }

  async regress(projectId: string, id: string, actorId?: string): Promise<void> {
    await this.executeTransition(projectId, id, 'REGRESSED', actorId);
  }

  async assign(projectId: string, id: string, assigneeId: string, actorId?: string): Promise<void> {
    // Phase 14 future compatibility placeholder for Assignment table / fields
    domainEventBus.publish('ErrorAssigned', { projectId, groupId: id, assigneeId, actorId });
  }

  async unassign(projectId: string, id: string, actorId?: string): Promise<void> {
    domainEventBus.publish('ErrorUnassigned', { projectId, groupId: id, actorId });
  }

  async mute(projectId: string, id: string, actorId?: string): Promise<void> {
    domainEventBus.publish('ErrorMuted', { projectId, groupId: id, actorId });
  }

  async unmute(projectId: string, id: string, actorId?: string): Promise<void> {
    domainEventBus.publish('ErrorUnmuted', { projectId, groupId: id, actorId });
  }

  private async executeTransition(projectId: string, id: string, targetStatus: string, actorId?: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      
      const result = await client.query(
        `SELECT status, version FROM error_groups WHERE project_id = $1 AND id = $2 FOR UPDATE`,
        [projectId, id]
      );
      
      if (result.rows.length === 0) {
        throw new Error('Group not found');
      }
      
      const currentStatus = result.rows[0].status;
      const currentVersion = result.rows[0].version;
      
      this.validateTransition(currentStatus, targetStatus);
      
      // Update
      if (targetStatus === 'RESOLVED') {
        await this.errorGroupRepo.resolve(client, projectId, id);
      } else if (targetStatus === 'IGNORED') {
        await this.errorGroupRepo.ignore(client, projectId, id);
      } else if (targetStatus === 'OPEN') {
        await this.errorGroupRepo.reopen(client, projectId, id);
      } else if (targetStatus === 'ARCHIVED') {
        await this.errorGroupRepo.archive(client, projectId, id);
      } else if (targetStatus === 'REGRESSED') {
        // Assume regress uses reopen/open under the hood if missing in repo, but wait, error-group.repository.ts doesn't have regress.
        // Let's just use raw query here if needed, or I'll add regress to error-group.repository.ts
        await client.query(
          `UPDATE error_groups SET status = 'REGRESSED', version = version + 1, updated_at = NOW() WHERE project_id = $1 AND id = $2`,
          [projectId, id]
        );
      }
      
      // Insert history
      await this.historyRepo.insertHistory(client, {
        groupId: id,
        action: 'STATUS_CHANGED',
        oldValue: { status: currentStatus },
        newValue: { status: targetStatus },
        actorId
      });
      
      await client.query('COMMIT');
      
      const payload = { projectId, groupId: id, actorId };
      if (targetStatus === 'RESOLVED') domainEventBus.publish('ErrorResolved', payload);
      else if (targetStatus === 'IGNORED') domainEventBus.publish('ErrorIgnored', payload);
      else if (targetStatus === 'ARCHIVED') domainEventBus.publish('ErrorArchived', payload);
      else if (targetStatus === 'REGRESSED') domainEventBus.publish('ErrorRegressed', { errorGroupId: id, projectId });
      else if (targetStatus === 'OPEN') {
        if (currentStatus === 'ARCHIVED') domainEventBus.publish('ErrorRestored', payload);
        else domainEventBus.publish('ErrorReopened', payload);
      }
      
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private validateTransition(from: string, to: string) {
    const valid: Record<string, string[]> = {
      'OPEN': ['RESOLVED', 'IGNORED', 'ARCHIVED'],
      'RESOLVED': ['OPEN', 'REGRESSED'],
      'REGRESSED': ['RESOLVED', 'IGNORED', 'OPEN'],
      'IGNORED': ['OPEN'],
      'ARCHIVED': ['OPEN']
    };
    
    if (!valid[from] || !valid[from].includes(to)) {
      throw new InvalidTransitionError(`${from} -> ${to}`);
    }
  }
}

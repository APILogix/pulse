import type { Pool, PoolClient } from 'pg';

export interface CreateHistoryParams {
  groupId: string;
  action: string;
  previousStatus?: string | null;
  newStatus?: string | null;
  actorId?: string | null;
  actorType?: string;
  eventId?: string | null;
  release?: string | null;
  occurredAt?: Date | null;
  reason?: string | null;
  sourceGroupId?: string | null;
  targetGroupId?: string | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export class ErrorGroupHistoryRepository {
  constructor(private readonly pool: Pool) {}

  async insertHistory(client: PoolClient, params: CreateHistoryParams): Promise<void> {
    await client.query(
      `INSERT INTO error_group_history (
         group_id, action, previous_status, new_status, actor_id, actor_type,
         event_id, release, occurred_at, reason, source_group_id, target_group_id,
         old_value, new_value, metadata, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())`,
      [
        params.groupId,
        params.action,
        params.previousStatus ?? null,
        params.newStatus ?? null,
        params.actorId ?? null,
        params.actorType ?? (params.actorId ? 'user' : 'system'),
        params.eventId ?? null,
        params.release ?? null,
        params.occurredAt ?? null,
        params.reason ?? null,
        params.sourceGroupId ?? null,
        params.targetGroupId ?? null,
        params.oldValue ? JSON.stringify(params.oldValue) : null,
        params.newValue ? JSON.stringify(params.newValue) : null,
        params.metadata ? JSON.stringify(params.metadata) : null,
      ],
    );
  }
}

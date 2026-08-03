import type { Pool, PoolClient } from 'pg';

export interface CreateHistoryParams {
  groupId: string;
  action: string;
  oldValue?: Record<string, any> | null;
  newValue?: Record<string, any> | null;
  actorId?: string | null;
  metadata?: Record<string, any> | null;
}

export class ErrorGroupHistoryRepository {
  constructor(private readonly pool: Pool) {}

  async insertHistory(client: PoolClient, params: CreateHistoryParams): Promise<void> {
    const { groupId, action, oldValue, newValue, actorId, metadata } = params;
    
    await client.query(
      `INSERT INTO error_group_history (group_id, action, old_value, new_value, actor_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        groupId,
        action,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
        actorId || null,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );
  }
}

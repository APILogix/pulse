import type { Pool, PoolClient } from 'pg';
import type { ErrorGroupEventRecord } from '../models/error-group.model.ts';

export class ErrorRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Inserts an error event using a given client (for transactions).
   */
  async insert(client: PoolClient, record: ErrorGroupEventRecord): Promise<void> {
    const query = `
      INSERT INTO events_errors (
        id,
        organization_id,
        project_id,
        error_group_id,
        event_id,
        fingerprint,
        message,
        error_name,
        severity,
        timestamp,
        payload
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      )
      ON CONFLICT (project_id, event_id) DO NOTHING
    `;

    await client.query(query, [
      record.id,
      record.organization_id,
      record.project_id,
      record.error_group_id,
      record.event_id,
      record.fingerprint,
      record.message,
      record.error_name,
      record.severity,
      record.timestamp,
      record.payload
    ]);
  }

  async find(projectId: string, eventId: string): Promise<ErrorGroupEventRecord | null> {
    const result = await this.pool.query(
      `SELECT * FROM events_errors WHERE project_id = $1 AND event_id = $2`,
      [projectId, eventId]
    );

    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  async findByGroup(projectId: string, errorGroupId: string): Promise<ErrorGroupEventRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM events_errors WHERE project_id = $1 AND error_group_id = $2 ORDER BY timestamp DESC`,
      [projectId, errorGroupId]
    );
    return result.rows;
  }
}

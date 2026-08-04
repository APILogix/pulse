import type { Pool, PoolClient } from 'pg';
import type { ErrorGroupEventRecord } from '../models/error-group.model.ts';

export class ErrorRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Inserts an error event using a given client (for transactions).
   */
  async insert(client: PoolClient, record: ErrorGroupEventRecord): Promise<boolean> {
    const query = `
      INSERT INTO events_errors (
        id,
        organization_id,
        project_id,
        api_key_name,
        environment,
        error_group_id,
        event_id,
        request_id,
        trace_id,
        span_id,
        parent_span_id,
        session_id,
        user_id,
        fingerprint,
        error_name,
        message,
        severity,
        mechanism,
        handled,
        method,
        route,
        url,
        status_code,
        status_text,
        stack_frames,
        breadcrumbs,
        context,
        service,
        server_name,
        release,
        sdk_name,
        sdk_version,
        application_name,
        application_version,
        tags,
        extra,
        metadata,
        ai_response,
        timestamp,
        occurred_at,
        payload
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
        $31, $32, $33, $34, $35, $36, $37, $38, $39, $39,
        $40
      )
      ON CONFLICT (organization_id, event_id, occurred_at) DO NOTHING
      RETURNING id
    `;

    const result = await client.query(query, [
      record.id,
      record.organization_id,
      record.project_id,
      record.api_key_name ?? '',
      record.environment ?? 'production',
      record.error_group_id,
      record.event_id,
      record.request_id ?? null,
      record.trace_id ?? null,
      record.span_id ?? null,
      record.parent_span_id ?? null,
      record.session_id ?? null,
      record.user_id ?? null,
      record.fingerprint,
      record.error_name,
      record.message,
      record.severity,
      record.mechanism ?? null,
      record.handled ?? null,
      record.method ?? null,
      record.route ?? null,
      record.url ?? null,
      record.status_code ?? null,
      record.status_text ?? null,
      record.stack_frames ? JSON.stringify(record.stack_frames) : JSON.stringify([]),
      record.breadcrumbs ? JSON.stringify(record.breadcrumbs) : JSON.stringify([]),
      record.context ? JSON.stringify(record.context) : JSON.stringify({}),
      record.service ?? null,
      record.server_name ?? null,
      record.release ?? null,
      record.sdk_name ?? null,
      record.sdk_version ?? null,
      record.application_name ?? null,
      record.application_version ?? null,
      record.tags ? JSON.stringify(record.tags) : JSON.stringify({}),
      record.extra ? JSON.stringify(record.extra) : JSON.stringify({}),
      record.metadata ? JSON.stringify(record.metadata) : JSON.stringify({}),
      record.ai_response ? JSON.stringify(record.ai_response) : null,
      record.timestamp,
      record.payload
    ]);

    return result.rowCount !== null && result.rowCount > 0;
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

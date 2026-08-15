import type { Pool, PoolClient } from 'pg';
import type { ErrorGroupEventRecord } from '../models/error-group.model.js';

export interface InsertErrorResult {
  inserted: boolean;
  id: string | null;
}

export class ErrorRepository {
  constructor(private readonly pool: Pool) {}

  async insertIfNew(client: PoolClient, record: ErrorGroupEventRecord): Promise<InsertErrorResult> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO events_errors (
         id, organization_id, project_id, api_key_name, environment,
         event_id, request_id, trace_id, span_id, parent_span_id, session_id, user_id,
         fingerprint, error_name, message, severity, mechanism, handled,
         method, route, url, status_code, status_text,
         stack_frames, breadcrumbs, context, service, server_name, release,
         sdk_name, sdk_version, application_name, application_version,
         tags, extra, metadata, ai_response, occurred_at, payload, error_group_id, fingerprint_version
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10, $11, $12,
         $13, $14, $15, $16, $17, $18,
         $19, $20, $21, $22, $23,
         $24::jsonb, $25::jsonb, $26::jsonb, $27, $28, $29,
         $30, $31, $32, $33,
         $34::jsonb, $35::jsonb, $36::jsonb, $37::jsonb, $38, $39::jsonb, $40, $41
       )
       ON CONFLICT (organization_id, event_id, occurred_at) DO NOTHING
       RETURNING id`,
      [
        record.id,
        record.organization_id,
        record.project_id,
        record.api_key_name ?? '',
        record.environment ?? 'production',
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
        JSON.stringify(record.stack_frames ?? []),
        JSON.stringify(record.breadcrumbs ?? []),
        JSON.stringify(record.context ?? {}),
        record.service ?? null,
        record.server_name ?? null,
        record.release ?? null,
        record.sdk_name ?? null,
        record.sdk_version ?? null,
        record.application_name ?? null,
        record.application_version ?? null,
        JSON.stringify(record.tags ?? {}),
        JSON.stringify(record.extra ?? {}),
        JSON.stringify(record.metadata ?? {}),
        record.ai_response == null ? null : JSON.stringify(record.ai_response),
        record.occurred_at,
        JSON.stringify(record.payload ?? {}),
        record.error_group_id ?? null,
        record.fingerprint_version ?? 2,
      ],
    );

    return {
      inserted: result.rowCount === 1,
      id: result.rows[0]?.id ?? null,
    };
  }

  async attachGroup(client: PoolClient, organizationId: string, eventId: string, occurredAt: Date, groupId: string): Promise<void> {
    await client.query(
      `UPDATE events_errors
          SET error_group_id = $4
        WHERE organization_id = $1 AND event_id = $2 AND occurred_at = $3`,
      [organizationId, eventId, occurredAt, groupId],
    );
  }

  async insert(client: PoolClient, record: ErrorGroupEventRecord): Promise<boolean> {
    return (await this.insertIfNew(client, record)).inserted;
  }

  async find(projectId: string, eventId: string): Promise<ErrorGroupEventRecord | null> {
    const result = await this.pool.query(
      `SELECT * FROM events_errors WHERE project_id = $1 AND event_id = $2 ORDER BY occurred_at DESC LIMIT 1`,
      [projectId, eventId],
    );
    return result.rows[0] ?? null;
  }

  async findByGroup(projectId: string, errorGroupId: string, limit = 100): Promise<ErrorGroupEventRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM events_errors
        WHERE project_id = $1 AND error_group_id = $2
        ORDER BY occurred_at DESC, event_id DESC
        LIMIT $3`,
      [projectId, errorGroupId, Math.max(1, Math.min(limit, 500))],
    );
    return result.rows;
  }
}

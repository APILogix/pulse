import type { Pool, PoolClient } from 'pg';
import type { ErrorGroupEventRecord } from '../models/error-group.model.js';

export interface InsertErrorResult {
  inserted: boolean;
  id: string | null;
}

export interface InsertedErrorRecord {
  id: string;
  organizationId: string;
  eventId: string;
  occurredAt: Date;
}

export interface ErrorGroupAttachment {
  organizationId: string;
  eventId: string;
  occurredAt: Date;
  groupId: string;
}

const ERROR_EVENT_COLUMNS = [
  'id', 'organization_id', 'project_id', 'api_key_name', 'environment',
  'event_id', 'request_id', 'trace_id', 'span_id', 'parent_span_id', 'session_id', 'user_id',
  'fingerprint', 'error_name', 'message', 'severity', 'mechanism', 'handled',
  'method', 'route', 'url', 'status_code', 'status_text',
  'stack_frames', 'breadcrumbs', 'context', 'service', 'server_name', 'release',
  'sdk_name', 'sdk_version', 'application_name', 'application_version',
  'tags', 'extra', 'metadata', 'ai_response', 'occurred_at', 'payload', 'error_group_id', 'fingerprint_version',
] as const;

const ERROR_EVENT_VALUE_CASTS = new Map<number, string>([
  [23, '::jsonb'],
  [24, '::jsonb'],
  [25, '::jsonb'],
  [33, '::jsonb'],
  [34, '::jsonb'],
  [35, '::jsonb'],
  [36, '::jsonb'],
  [38, '::jsonb'],
]);

function errorEventValues(record: ErrorGroupEventRecord): unknown[] {
  return [
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
  ];
}

function buildErrorInsert(records: ErrorGroupEventRecord[], returning: string): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  let param = 1;
  const tuples = records.map((record) => {
    const row = errorEventValues(record);
    values.push(...row);
    return `(${row.map((_, index) => `$${param++}${ERROR_EVENT_VALUE_CASTS.get(index) ?? ''}`).join(', ')})`;
  });

  return {
    sql: `INSERT INTO events_errors (
         ${ERROR_EVENT_COLUMNS.join(', ')}
       ) VALUES ${tuples.join(', ')}
       ON CONFLICT (organization_id, event_id, occurred_at) DO NOTHING
       RETURNING ${returning}`,
    values,
  };
}

function insertedKey(row: { organization_id: string; event_id: string; occurred_at: Date | string }): string {
  return `${row.organization_id}\u0000${row.event_id}\u0000${new Date(row.occurred_at).getTime()}`;
}

export class ErrorRepository {
  constructor(private readonly pool: Pool) {}

  async insertIfNew(client: PoolClient, record: ErrorGroupEventRecord): Promise<InsertErrorResult> {
    const { sql, values } = buildErrorInsert([record], 'id');
    const result = await client.query<{ id: string }>(
      sql,
      values,
    );

    return {
      inserted: result.rowCount === 1,
      id: result.rows[0]?.id ?? null,
    };
  }

  async insertManyIfNew(client: PoolClient, records: ErrorGroupEventRecord[]): Promise<InsertedErrorRecord[]> {
    if (records.length === 0) return [];

    const { sql, values } = buildErrorInsert(
      records,
      'id, organization_id, event_id, occurred_at',
    );
    const result = await client.query<{
      id: string;
      organization_id: string;
      event_id: string;
      occurred_at: Date | string;
    }>(sql, values);

    const insertedByKey = new Map<string, InsertedErrorRecord[]>();
    for (const row of result.rows) {
      const key = insertedKey(row);
      const list = insertedByKey.get(key) ?? [];
      list.push({
        id: row.id,
        organizationId: row.organization_id,
        eventId: row.event_id,
        occurredAt: new Date(row.occurred_at),
      });
      insertedByKey.set(key, list);
    }

    const inserted: InsertedErrorRecord[] = [];
    for (const record of records) {
      const key = insertedKey({
        organization_id: record.organization_id,
        event_id: record.event_id,
        occurred_at: record.occurred_at,
      });
      const list = insertedByKey.get(key);
      const row = list?.shift();
      if (!row) continue;
      inserted.push(row);
      if (list && list.length === 0) insertedByKey.delete(key);
    }

    return inserted;
  }

  async attachGroup(client: PoolClient, organizationId: string, eventId: string, occurredAt: Date, groupId: string): Promise<void> {
    await client.query(
      `UPDATE events_errors
          SET error_group_id = $4
        WHERE organization_id = $1 AND event_id = $2 AND occurred_at = $3`,
      [organizationId, eventId, occurredAt, groupId],
    );
  }

  async attachGroups(client: PoolClient, attachments: ErrorGroupAttachment[]): Promise<void> {
    if (attachments.length === 0) return;

    const values: unknown[] = [];
    let param = 1;
    const rows = attachments.map((attachment) => {
      values.push(
        attachment.organizationId,
        attachment.eventId,
        attachment.occurredAt,
        attachment.groupId,
      );
      const tuple = `($${param}::uuid, $${param + 1}, $${param + 2}::timestamptz, $${param + 3}::uuid)`;
      param += 4;
      return tuple;
    });

    await client.query(
      `UPDATE events_errors AS e
          SET error_group_id = v.group_id::uuid
         FROM (VALUES ${rows.join(', ')}) AS v(organization_id, event_id, occurred_at, group_id)
        WHERE e.organization_id = v.organization_id
          AND e.event_id = v.event_id
          AND e.occurred_at = v.occurred_at`,
      values,
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

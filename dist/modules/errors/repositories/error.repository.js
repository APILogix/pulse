const ERROR_EVENT_COLUMNS = [
    'id', 'organization_id', 'project_id', 'api_key_name', 'environment',
    'event_id', 'request_id', 'trace_id', 'span_id', 'parent_span_id', 'session_id', 'user_id',
    'fingerprint', 'error_name', 'message', 'severity', 'mechanism', 'handled',
    'method', 'route', 'url', 'status_code', 'status_text',
    'stack_frames', 'breadcrumbs', 'context', 'service', 'server_name', 'release',
    'sdk_name', 'sdk_version', 'application_name', 'application_version',
    'tags', 'extra', 'metadata', 'ai_response', 'occurred_at', 'payload', 'error_group_id', 'fingerprint_version',
];
const ERROR_EVENT_VALUE_CASTS = new Map([
    [23, '::jsonb'],
    [24, '::jsonb'],
    [25, '::jsonb'],
    [33, '::jsonb'],
    [34, '::jsonb'],
    [35, '::jsonb'],
    [36, '::jsonb'],
    [38, '::jsonb'],
]);
function errorEventValues(record) {
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
function buildErrorInsert(records, returning) {
    const values = [];
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
function insertedKey(row) {
    return `${row.organization_id}\u0000${row.event_id}\u0000${new Date(row.occurred_at).getTime()}`;
}
export class ErrorRepository {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async insertIfNew(client, record) {
        const { sql, values } = buildErrorInsert([record], 'id');
        const result = await client.query(sql, values);
        return {
            inserted: result.rowCount === 1,
            id: result.rows[0]?.id ?? null,
        };
    }
    async insertManyIfNew(client, records) {
        if (records.length === 0)
            return [];
        const { sql, values } = buildErrorInsert(records, 'id, organization_id, event_id, occurred_at');
        const result = await client.query(sql, values);
        const insertedByKey = new Map();
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
        const inserted = [];
        for (const record of records) {
            const key = insertedKey({
                organization_id: record.organization_id,
                event_id: record.event_id,
                occurred_at: record.occurred_at,
            });
            const list = insertedByKey.get(key);
            const row = list?.shift();
            if (!row)
                continue;
            inserted.push(row);
            if (list && list.length === 0)
                insertedByKey.delete(key);
        }
        return inserted;
    }
    async attachGroup(client, organizationId, eventId, occurredAt, groupId) {
        await client.query(`UPDATE events_errors
          SET error_group_id = $4
        WHERE organization_id = $1 AND event_id = $2 AND occurred_at = $3`, [organizationId, eventId, occurredAt, groupId]);
    }
    async attachGroups(client, attachments) {
        if (attachments.length === 0)
            return;
        const values = [];
        let param = 1;
        const rows = attachments.map((attachment) => {
            values.push(attachment.organizationId, attachment.eventId, attachment.occurredAt, attachment.groupId);
            const tuple = `($${param}::uuid, $${param + 1}, $${param + 2}::timestamptz, $${param + 3}::uuid)`;
            param += 4;
            return tuple;
        });
        await client.query(`UPDATE events_errors AS e
          SET error_group_id = v.group_id::uuid
         FROM (VALUES ${rows.join(', ')}) AS v(organization_id, event_id, occurred_at, group_id)
        WHERE e.organization_id = v.organization_id
          AND e.event_id = v.event_id
          AND e.occurred_at = v.occurred_at`, values);
    }
    async insert(client, record) {
        return (await this.insertIfNew(client, record)).inserted;
    }
    async find(projectId, eventId) {
        const result = await this.pool.query(`SELECT ${ERROR_EVENT_COLUMNS.join(', ')} FROM events_errors WHERE project_id = $1 AND event_id = $2 ORDER BY occurred_at DESC LIMIT 1`, [projectId, eventId]);
        return result.rows[0] ?? null;
    }
    async findByGroup(projectId, errorGroupId, limit = 100) {
        const result = await this.pool.query(`SELECT ${ERROR_EVENT_COLUMNS.join(', ')} FROM events_errors
        WHERE project_id = $1
          AND (
            error_group_id = $2
            OR error_group_id IN (
              SELECT id FROM error_groups WHERE project_id = $1 AND merged_into = $2
            )
          )
        ORDER BY occurred_at DESC, event_id DESC
        LIMIT $3`, [projectId, errorGroupId, Math.max(1, Math.min(limit, 500))]);
        return result.rows;
    }
}
//# sourceMappingURL=error.repository.js.map
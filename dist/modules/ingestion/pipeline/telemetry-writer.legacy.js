import { resolveTimestamp } from './event-normalizer.js';
function iso(ms) {
    return new Date(ms).toISOString();
}
function buildInsert(table, cols, rows) {
    const values = [];
    const tuples = [];
    let p = 1;
    for (const row of rows) {
        tuples.push(`(${row.map(() => `$${p++}`).join(', ')})`);
        values.push(...row);
    }
    return {
        text: `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${tuples.join(', ')}`,
        values,
    };
}
export class LegacyTelemetryWriter {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async writeBatch(scoped) {
        if (scoped.length === 0)
            return 0;
        const byType = new Map();
        for (const s of scoped) {
            const list = byType.get(s.event.type) ?? [];
            list.push(s);
            byType.set(s.event.type, list);
        }
        let total = 0;
        for (const [type, list] of byType) {
            total += await this.writeTyped(type, list);
        }
        return total;
    }
    async writeTyped(type, list) {
        switch (type) {
            case 'span': return this.writeSpans(list);
            case 'metric': return this.writeMetrics(list);
            case 'log': return this.writeLogs(list);
            case 'cron_checkin': return this.writeCronCheckins(list);
            case 'replay': return this.writeReplays(list);
            case 'message': return this.writeMessages(list);
            default: return 0;
        }
    }
    async writeSpans(list) {
        const rows = list.map(({ projectId, orgId, event }) => {
            const e = event;
            const ts = e.startTime ?? resolveTimestamp(event);
            return [
                projectId, orgId, e.traceId, e.spanId, e.parentSpanId ?? null,
                e.name, e.kind ?? null, e.status ?? null, e.statusMessage ?? null,
                iso(e.startTime), e.endTime != null ? iso(e.endTime) : null,
                e.duration ?? null, e.exclusiveDuration ?? null,
                JSON.stringify(e.attributes ?? {}), JSON.stringify(e.events ?? []), JSON.stringify(e.links ?? []),
                e.requestId ?? null, e.sessionId ?? null, null, iso(ts),
            ];
        });
        const { text, values } = buildInsert('spans', ['project_id', 'org_id', 'trace_id', 'span_id', 'parent_span_id', 'name', 'kind',
            'status', 'status_message', 'start_time', 'end_time', 'duration_ms', 'exclusive_duration_ms',
            'attributes', 'events', 'links', 'request_id', 'session_id', 'user_id', 'timestamp'], rows);
        const r = await this.pool.query(text, values);
        return r.rowCount ?? 0;
    }
    async writeMetrics(list) {
        const rows = list.map(({ projectId, orgId, event }) => {
            const e = event;
            return [
                projectId, orgId, e.metricName, e.metricType, e.value ?? null, e.unit ?? null,
                e.count ?? null, e.sum ?? null, e.min ?? null, e.max ?? null, e.avg ?? null,
                e.buckets != null ? JSON.stringify(e.buckets) : null,
                JSON.stringify(e.tags ?? {}), iso(resolveTimestamp(event)),
            ];
        });
        const { text, values } = buildInsert('metrics', ['project_id', 'org_id', 'metric_name', 'metric_type', 'value', 'unit',
            'count', 'sum', 'min', 'max', 'avg', 'buckets', 'tags', 'timestamp'], rows);
        const r = await this.pool.query(text, values);
        return r.rowCount ?? 0;
    }
    async writeLogs(list) {
        const rows = list.map(({ projectId, orgId, event }) => {
            const e = event;
            return [
                projectId, orgId, e.level, e.message, JSON.stringify(e.args ?? []),
                e.requestId ?? null, e.traceId ?? null, e.spanId ?? null, iso(resolveTimestamp(event)),
            ];
        });
        const { text, values } = buildInsert('logs', ['project_id', 'org_id', 'level', 'message', 'args', 'request_id', 'trace_id', 'span_id', 'timestamp'], rows);
        const r = await this.pool.query(text, values);
        return r.rowCount ?? 0;
    }
    async writeCronCheckins(list) {
        const rows = list.map(({ projectId, orgId, event }) => {
            const e = event;
            return [
                projectId, orgId, e.monitorSlug, e.status, e.duration ?? null,
                e.environment ?? null, iso(resolveTimestamp(event)),
            ];
        });
        const { text, values } = buildInsert('cron_checkins', ['project_id', 'org_id', 'monitor_slug', 'status', 'duration_ms', 'environment', 'timestamp'], rows);
        const r = await this.pool.query(text, values);
        return r.rowCount ?? 0;
    }
    async writeReplays(list) {
        const rows = list.map(({ projectId, orgId, event }) => {
            const e = event;
            return [
                projectId, orgId, e.sessionId, e.segmentId, JSON.stringify(e.events ?? []),
                iso(resolveTimestamp(event)),
            ];
        });
        const { text, values } = buildInsert('replays', ['project_id', 'org_id', 'session_id', 'segment_id', 'events', 'timestamp'], rows);
        const r = await this.pool.query(text, values);
        return r.rowCount ?? 0;
    }
    async writeMessages(list) {
        const rows = list.map(({ projectId, orgId, event }) => {
            const e = event;
            return [
                projectId, orgId, e.message, e.severity ?? 'info',
                JSON.stringify(e.context ?? {}), JSON.stringify(e.breadcrumbs ?? []),
                e.requestId ?? null, e.traceId ?? null, e.spanId ?? null, iso(resolveTimestamp(event)),
            ];
        });
        const { text, values } = buildInsert('messages', ['project_id', 'org_id', 'message', 'severity', 'context', 'breadcrumbs',
            'request_id', 'trace_id', 'span_id', 'timestamp'], rows);
        const r = await this.pool.query(text, values);
        return r.rowCount ?? 0;
    }
}
//# sourceMappingURL=telemetry-writer.legacy.js.map
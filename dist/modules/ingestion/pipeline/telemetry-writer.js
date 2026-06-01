import { resolveTimestamp } from './event-normalizer.js';
function iso(ms) {
    return new Date(ms).toISOString();
}
/** Build a parameterized multi-row INSERT. cols: column names; rows: value arrays. */
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
export class TelemetryWriter {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    /**
     * Route a batch of scoped events to the correct table(s). Events of mixed
     * types are grouped so each table gets one insert. Returns count persisted.
     */
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
            case 'trace': return this.writeTraces(list);
            case 'metric': return this.writeMetrics(list);
            case 'log': return this.writeLogs(list);
            case 'profile': return this.writeProfiles(list);
            case 'cron_checkin': return this.writeCronCheckins(list);
            case 'replay': return this.writeReplays(list);
            case 'message': return this.writeMessages(list);
            case 'error': return this.writeErrors(list);
            case 'request': return this.writeRequests(list);
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
    async writeTraces(list) {
        // Traces are upserted in a single multi-row statement. Per-row INSERTs
        // would multiply DB round trips by the batch size — at high ingest rates
        // that exhausts pool capacity AND blows up the per-batch latency. We use
        // ON CONFLICT (project_id, trace_id, timestamp) so partial→complete
        // re-emits replace rather than duplicate.
        if (list.length === 0)
            return 0;
        const cols = [
            'project_id', 'org_id', 'trace_id', 'root_span', 'span_count',
            'total_duration_ms', 'is_partial', 'root_name', 'has_error',
            'request_id', 'session_id', 'timestamp',
        ];
        const tuples = [];
        const values = [];
        let p = 1;
        for (const { projectId, orgId, event } of list) {
            const e = event;
            const ts = resolveTimestamp(event);
            const root = e.rootSpan;
            const hasError = root?.status === 'error';
            // 12 columns; the 4th ($p+3) is JSONB and the rest are scalars/timestamps.
            tuples.push(`($${p},$${p + 1},$${p + 2},$${p + 3}::jsonb,$${p + 4},$${p + 5},$${p + 6},$${p + 7},$${p + 8},$${p + 9},$${p + 10},$${p + 11})`);
            p += 12;
            values.push(projectId, orgId, e.traceId, JSON.stringify(e.rootSpan ?? {}), e.spanCount, e.totalDuration ?? null, e.isPartial ?? false, root?.name ?? null, hasError, e.requestId ?? null, e.sessionId ?? null, iso(ts));
        }
        const text = `
      INSERT INTO traces (${cols.join(', ')})
      VALUES ${tuples.join(', ')}
      ON CONFLICT (project_id, trace_id, timestamp) DO UPDATE SET
        root_span = EXCLUDED.root_span,
        span_count = EXCLUDED.span_count,
        total_duration_ms = EXCLUDED.total_duration_ms,
        is_partial = EXCLUDED.is_partial,
        has_error = EXCLUDED.has_error
    `;
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
    async writeProfiles(list) {
        const rows = list.map(({ projectId, orgId, event }) => {
            const e = event;
            return [
                projectId, orgId, e.profileType,
                e.startTime != null ? iso(e.startTime) : null,
                e.endTime != null ? iso(e.endTime) : null,
                e.duration ?? null, e.profile != null ? JSON.stringify(e.profile) : null,
                e.requestId ?? null, e.traceId ?? null, e.spanId ?? null, iso(resolveTimestamp(event)),
            ];
        });
        const { text, values } = buildInsert('profiles', ['project_id', 'org_id', 'profile_type', 'start_time', 'end_time', 'duration_ms',
            'profile', 'request_id', 'trace_id', 'span_id', 'timestamp'], rows);
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
    /**
     * Errors are persisted to the partitioned `errors` table and rolled up into
     * `error_groups` for analytics. Both project_id and org_id come from the
     * authenticated API key, never the payload.
     *
     * Performance note: The original implementation inserted one row at a time
     * AND issued a separate fingerprint-rollup statement per event. At high
     * error rates that doubles round trips per event and exhausts the pool.
     * This version uses one multi-row INSERT for the canonical errors table
     * and a single multi-row UPSERT for the rollup, both inside the same call
     * stack. The rollup is still best-effort: if it fails, the durable error
     * write has already committed.
     */
    async writeErrors(list) {
        if (list.length === 0)
            return 0;
        const prepared = list.map(({ projectId, orgId, event }) => {
            const e = event;
            const ts = resolveTimestamp(event);
            const errorType = typeof e.name === 'string' ? e.name.slice(0, 256) : 'UnknownError';
            const fingerprint = (e.fingerprint && e.fingerprint.slice(0, 128)) ||
                `auto:${errorType}:${e.message.slice(0, 64)}`;
            return {
                projectId,
                orgId,
                message: e.message,
                errorType,
                fingerprint,
                severity: e.severity ?? null,
                stack: JSON.stringify(e.stack ?? []),
                context: JSON.stringify(e.context ?? {}),
                breadcrumbs: JSON.stringify(e.breadcrumbs ?? []),
                requestId: e.requestId ?? null,
                traceId: e.traceId ?? null,
                spanId: e.spanId ?? null,
                sessionId: e.sessionId ?? null,
                timestampIso: iso(ts),
            };
        });
        // ── 1. Multi-row INSERT into the canonical errors table ────────────────
        const errorCols = [
            'project_id', 'org_id', 'message', 'error_type', 'fingerprint',
            'severity', 'stack', 'context', 'breadcrumbs', 'request_id',
            'trace_id', 'span_id', 'session_id', 'timestamp',
        ];
        const errorTuples = [];
        const errorValues = [];
        {
            let p = 1;
            for (const r of prepared) {
                // 14 columns; 7,8,9 are JSONB.
                errorTuples.push(`($${p},$${p + 1},$${p + 2},$${p + 3},$${p + 4},$${p + 5},` +
                    `$${p + 6}::jsonb,$${p + 7}::jsonb,$${p + 8}::jsonb,` +
                    `$${p + 9},$${p + 10},$${p + 11},$${p + 12},$${p + 13})`);
                p += 14;
                errorValues.push(r.projectId, r.orgId, r.message, r.errorType, r.fingerprint, r.severity, r.stack, r.context, r.breadcrumbs, r.requestId, r.traceId, r.spanId, r.sessionId, r.timestampIso);
            }
        }
        const errorInsert = `
      INSERT INTO errors (${errorCols.join(', ')})
      VALUES ${errorTuples.join(', ')}
    `;
        const inserted = await this.pool.query(errorInsert, errorValues);
        const rollupMap = new Map();
        for (const r of prepared) {
            const key = `${r.projectId}::${r.fingerprint}`;
            const existing = rollupMap.get(key);
            if (existing) {
                existing.count += 1;
                if (r.timestampIso < existing.firstSeen)
                    existing.firstSeen = r.timestampIso;
                if (r.timestampIso > existing.lastSeen) {
                    existing.lastSeen = r.timestampIso;
                    existing.lastMessage = r.message;
                    existing.errorType = r.errorType;
                }
            }
            else {
                rollupMap.set(key, {
                    projectId: r.projectId,
                    fingerprint: r.fingerprint,
                    firstSeen: r.timestampIso,
                    lastSeen: r.timestampIso,
                    count: 1,
                    lastMessage: r.message,
                    errorType: r.errorType,
                });
            }
        }
        if (rollupMap.size > 0) {
            const rollupTuples = [];
            const rollupValues = [];
            let p = 1;
            for (const v of rollupMap.values()) {
                // 7 columns: project_id, fingerprint, first_seen, last_seen, occurrences, last_message, error_type
                rollupTuples.push(`($${p},$${p + 1},$${p + 2},$${p + 3},$${p + 4},$${p + 5},$${p + 6})`);
                p += 7;
                rollupValues.push(v.projectId, v.fingerprint, v.firstSeen, v.lastSeen, v.count, v.lastMessage, v.errorType);
            }
            const rollupSql = `
        INSERT INTO error_groups
          (project_id, fingerprint, first_seen, last_seen, occurrences, last_message, error_type)
        VALUES ${rollupTuples.join(', ')}
        ON CONFLICT (project_id, fingerprint) DO UPDATE SET
          last_seen   = GREATEST(error_groups.last_seen, EXCLUDED.last_seen),
          first_seen  = LEAST(error_groups.first_seen, EXCLUDED.first_seen),
          occurrences = error_groups.occurrences + EXCLUDED.occurrences,
          last_message = EXCLUDED.last_message,
          error_type   = EXCLUDED.error_type,
          updated_at   = NOW()
      `;
            await this.pool.query(rollupSql, rollupValues).catch(() => {
                /* rollup is best-effort; the durable errors row is already committed */
            });
        }
        return inserted.rowCount ?? prepared.length;
    }
    async writeRequests(list) {
        const rows = list.map(({ projectId, orgId, event }) => {
            const e = event;
            const p = e;
            return [
                projectId, orgId, e.requestId ?? null, e.url, e.method,
                e.statusCode, e.latency, e.bodySize ?? null,
                typeof p.responseSize === 'number' ? p.responseSize : null,
                e.userId ?? null,
                typeof p.tenantId === 'string' ? p.tenantId : null,
                e.sessionId ?? null,
                typeof p.clientIp === 'string' ? p.clientIp : null,
                typeof p.userAgent === 'string' ? p.userAgent : null,
                typeof p.referer === 'string' ? p.referer : null,
                typeof p.route === 'string' ? p.route : null,
                e.traceId ?? null, e.spanId ?? null,
                JSON.stringify(e.headers ?? {}), JSON.stringify(e.query ?? {}),
                iso(resolveTimestamp(event)),
            ];
        });
        const { text, values } = buildInsert('requests', ['project_id', 'org_id', 'request_id', 'url', 'method', 'status_code', 'latency_ms',
            'body_size', 'response_size', 'user_id', 'tenant_id', 'session_id', 'client_ip',
            'user_agent', 'referer', 'route', 'trace_id', 'span_id', 'headers', 'query', 'timestamp'], rows);
        const r = await this.pool.query(text, values);
        return r.rowCount ?? 0;
    }
}
//# sourceMappingURL=telemetry-writer.js.map
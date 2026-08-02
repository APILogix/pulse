import { commonFields, commonSearchAliases, makeMapRow } from './common.js';
const LOG_LEVELS = ['debug', 'info', 'warn', 'warning', 'error', 'fatal'];
const logFields = {
    ...commonFields,
    level: { column: 'level', type: 'enum', enumValues: LOG_LEVELS, filterable: true, projectable: true, label: 'Level' },
    logger: { column: 'logger', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Logger' },
    requestId: { column: 'request_id', type: 'string', filterable: true, projectable: true, label: 'Request ID' },
    userIp: { column: 'user_ip', selectExpr: 'user_ip::text', type: 'string', filterable: true, projectable: true, label: 'User IP' },
};
export const logsResource = {
    name: 'logs',
    table: 'events_logs',
    timeColumn: 'timestamp',
    idColumn: 'id',
    fields: logFields,
    searchFields: ['message', 'logger', 'service'],
    searchAliases: { ...commonSearchAliases, level: 'level', logger: 'logger', source: 'logger' },
    defaultSort: { field: 'timestamp', direction: 'desc' },
    defaultProjection: [
        'id', 'projectId', 'environment', 'timestamp', 'level', 'message', 'logger',
        'service', 'traceId', 'spanId', 'requestId', 'userId',
    ],
    preferredIndexes: ['idx_events_logs_tenant_env_time', 'idx_events_logs_level_time'],
    errorPredicate: "level IN ('error','fatal') OR severity IN ('error','critical','fatal')",
    summary: {
        total: 'COUNT(*)::bigint',
        errorLogs: "(COUNT(*) FILTER (WHERE level IN ('error','fatal')))::bigint",
        warnLogs: "(COUNT(*) FILTER (WHERE level IN ('warn','warning')))::bigint",
        uniqueLoggers: 'COUNT(DISTINCT logger)::bigint',
    },
    mapRow: makeMapRow(['statusCode', 'durationMs']),
};
//# sourceMappingURL=logs.resource.js.map
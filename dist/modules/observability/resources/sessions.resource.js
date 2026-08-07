import { makeMapRow } from './common.js';
const sessionFields = {
    id: { column: 'id', type: 'uuid', filterable: true, sortable: false, projectable: true, label: 'ID' },
    organizationId: { column: 'organization_id', type: 'uuid', filterable: false, projectable: false },
    projectId: { column: 'project_id', type: 'uuid', filterable: false, projectable: false },
    environment: { column: 'environment', type: 'string', filterable: true, projectable: true, label: 'Environment' },
    sessionId: { column: 'session_id', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Session ID' },
    userId: { column: 'user_id', type: 'string', filterable: true, projectable: false, label: 'User' },
    startedAt: { column: 'started_at', type: 'timestamp', filterable: true, sortable: true, projectable: true, label: 'Started At' },
    endedAt: { column: 'ended_at', type: 'timestamp', filterable: true, sortable: true, projectable: true, label: 'Ended At' },
    durationMs: { column: 'duration_ms', type: 'number', filterable: true, sortable: true, projectable: true, label: 'Duration (ms)' },
    isCrashed: { column: 'is_crashed', type: 'boolean', filterable: true, projectable: true, label: 'Crashed' },
};
export const sessionsResource = {
    name: 'sessions',
    table: 'analytics_user_sessions',
    timeColumn: 'started_at',
    idColumn: 'id',
    fields: sessionFields,
    searchFields: ['sessionId'],
    searchAliases: { session: 'sessionId' },
    defaultSort: { field: 'startedAt', direction: 'desc' },
    defaultProjection: ['id', 'environment', 'sessionId', 'startedAt', 'endedAt', 'durationMs', 'isCrashed'],
    preferredIndexes: ['idx_analytics_sessions_org_time', 'idx_analytics_sessions_user'],
    summary: {
        total: 'COUNT(*)::bigint',
        crashed: '(COUNT(*) FILTER (WHERE is_crashed))::bigint',
        uniqueUsers: 'COUNT(DISTINCT user_id)::bigint',
    },
    statistics: {
        avgDuration: 'AVG(duration_ms)',
        maxDuration: 'MAX(duration_ms)',
    },
    mapRow: makeMapRow(['durationMs']),
};
//# sourceMappingURL=sessions.resource.js.map
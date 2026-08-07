import { commonFields, commonSearchAliases, makeMapRow } from './common.js';
const profileFields = {
    ...commonFields,
    profileType: { column: 'profile_type', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Profile Type' },
    requestId: { column: 'request_id', type: 'string', filterable: true, projectable: true, label: 'Request ID' },
    startTime: { column: 'start_time', type: 'timestamp', filterable: true, projectable: true, label: 'Start Time' },
    endTime: { column: 'end_time', type: 'timestamp', filterable: true, projectable: true, label: 'End Time' },
};
export const profilesResource = {
    name: 'profiles',
    table: 'events_profiles',
    timeColumn: 'occurred_at',
    idColumn: 'id',
    fields: profileFields,
    searchFields: ['profileType', 'service'],
    searchAliases: { ...commonSearchAliases, type: 'profileType', profile: 'profileType' },
    defaultSort: { field: 'occurredAt', direction: 'desc' },
    defaultProjection: [
        'id', 'environment', 'occurredAt', 'profileType', 'service', 'durationMs', 'requestId',
    ],
    preferredIndexes: ['idx_events_profiles_tenant_env_time'],
    errorPredicate: "severity IN ('error','critical','fatal')",
    summary: {
        total: 'COUNT(*)::bigint',
        uniqueTypes: 'COUNT(DISTINCT profile_type)::bigint',
    },
    statistics: {
        avgDuration: 'AVG(duration_ms)',
        maxDuration: 'MAX(duration_ms)',
    },
    mapRow: makeMapRow(['durationMs', 'statusCode']),
};
//# sourceMappingURL=profiles.resource.js.map
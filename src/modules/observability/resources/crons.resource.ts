/**
 * Cron check-ins explorer resource (Phase 11). Backed by `events_cron_checkins`.
 */
import type { ExplorerResource, FieldDef } from '../query-engine/field-registry.js';
import { commonFields, commonSearchAliases, makeMapRow } from './common.js';

const CRON_STATUS = ['ok', 'in_progress', 'error', 'failed', 'timeout', 'missed'] as const;

const cronFields: Record<string, FieldDef> = {
  ...commonFields,
  monitorSlug: { column: 'monitor_slug', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Monitor' },
  status: { column: 'status', type: 'enum', enumValues: CRON_STATUS, filterable: true, projectable: true, label: 'Status' },
};

export const cronsResource: ExplorerResource = {
  name: 'crons',
  table: 'events_cron_checkins',
  timeColumn: 'timestamp',
  idColumn: 'id',
  fields: cronFields,
  searchFields: ['monitorSlug', 'service'],
  searchAliases: { ...commonSearchAliases, monitor: 'monitorSlug', job: 'monitorSlug', slug: 'monitorSlug', status: 'status' },
  defaultSort: { field: 'timestamp', direction: 'desc' },
  defaultProjection: [
    'id', 'projectId', 'environment', 'timestamp', 'monitorSlug', 'status', 'durationMs', 'service',
  ],
  preferredIndexes: ['idx_events_cron_checkins_tenant_env_time'],
  errorPredicate: "status IN ('error','failed','timeout','missed')",
  summary: {
    total: 'COUNT(*)::bigint',
    ok: "(COUNT(*) FILTER (WHERE status = 'ok'))::bigint",
    failed: "(COUNT(*) FILTER (WHERE status IN ('error','failed','timeout','missed')))::bigint",
    uniqueMonitors: 'COUNT(DISTINCT monitor_slug)::bigint',
  },
  statistics: {
    avgRuntime: 'AVG(duration_ms)',
    maxRuntime: 'MAX(duration_ms)',
  },
  mapRow: makeMapRow(['durationMs', 'statusCode']),
};

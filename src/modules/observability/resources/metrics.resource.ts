/**
 * Metrics explorer resource (Phase 10). Backed by `events_metrics`.
 * Uses `idx_events_metrics_name_time` for metric-name filtering.
 */
import type { ExplorerResource, FieldDef } from '../query-engine/field-registry.js';
import { commonFields, commonSearchAliases, makeMapRow } from './common.js';

const metricFields: Record<string, FieldDef> = {
  ...commonFields,
  metricName: { column: 'metric_name', type: 'string', filterable: true, searchable: true, projectable: true, label: 'Metric' },
  metricType: { column: 'metric_type', type: 'string', filterable: true, projectable: true, label: 'Type' },
  value: { column: 'value', type: 'number', filterable: true, sortable: true, projectable: true, label: 'Value' },
  unit: { column: 'unit', type: 'string', filterable: true, projectable: true, label: 'Unit' },
  count: { column: 'count', type: 'number', filterable: true, projectable: true, label: 'Count' },
  sum: { column: 'sum', type: 'number', filterable: true, projectable: true, label: 'Sum' },
  min: { column: 'min', type: 'number', filterable: true, projectable: true, label: 'Min' },
  max: { column: 'max', type: 'number', filterable: true, projectable: true, label: 'Max' },
  avg: { column: 'avg', type: 'number', filterable: true, projectable: true, label: 'Avg' },
  rate: { column: 'rate', type: 'number', filterable: true, projectable: true, label: 'Rate' },
  p50: { column: 'p50', type: 'number', filterable: true, projectable: true, label: 'p50' },
  p75: { column: 'p75', type: 'number', filterable: true, projectable: true, label: 'p75' },
  p90: { column: 'p90', type: 'number', filterable: true, projectable: true, label: 'p90' },
  p95: { column: 'p95', type: 'number', filterable: true, projectable: true, label: 'p95' },
  p99: { column: 'p99', type: 'number', filterable: true, projectable: true, label: 'p99' },
  requestId: { column: 'request_id', type: 'string', filterable: true, projectable: true, label: 'Request ID' },
};

export const metricsResource: ExplorerResource = {
  name: 'metrics',
  table: 'events_metrics',
  timeColumn: 'timestamp',
  idColumn: 'id',
  fields: metricFields,
  searchFields: ['metricName', 'service'],
  searchAliases: { ...commonSearchAliases, metric: 'metricName', type: 'metricType', unit: 'unit' },
  defaultSort: { field: 'timestamp', direction: 'desc' },
  defaultProjection: [
    'id', 'projectId', 'environment', 'timestamp', 'metricName', 'metricType', 'value', 'unit',
    'service', 'requestId', 'p95', 'p99',
  ],
  preferredIndexes: ['idx_events_metrics_tenant_env_time', 'idx_events_metrics_name_time'],
  errorPredicate: "severity IN ('error','critical','fatal')",
  summary: {
    total: 'COUNT(*)::bigint',
    uniqueMetrics: 'COUNT(DISTINCT metric_name)::bigint',
  },
  statistics: {
    avgValue: 'AVG(value)',
    maxValue: 'MAX(value)',
    minValue: 'MIN(value)',
    sumValue: 'SUM(value)',
  },
  mapRow: makeMapRow([
    'value', 'count', 'sum', 'min', 'max', 'avg', 'rate',
    'p50', 'p75', 'p90', 'p95', 'p99', 'durationMs', 'statusCode',
  ]),
};

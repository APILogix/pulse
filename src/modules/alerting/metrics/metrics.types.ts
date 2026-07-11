import { z } from 'zod';
import { UuidSchema, PaginationSchema, AlertSeveritySchema, type AlertSeverity } from '../common.js';
import type { RequestMeta } from '../types.js';


import { AppError } from '../../../shared/errors/app-error.js';

export const MetricGranularitySchema = z.enum(['hour', 'day', 'week', 'month']);

export type MetricGranularity = z.infer<typeof MetricGranularitySchema>;

export const MetricsQuerySchema = z.object({
  metricType: z.string().max(50).optional(),
  ruleId: UuidSchema.optional(),
  granularity: MetricGranularitySchema.default('hour'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(168),
});

export type MetricsQuery = z.infer<typeof MetricsQuerySchema>;

export interface AlertMetricRow {
  id: string;
  organization_id: string;
  rule_id: string | null;
  metric_type: string;
  value: string; // NUMERIC arrives as string
  bucket_start: Date;
  bucket_end: Date;
  granularity: MetricGranularity;
  labels: Record<string, unknown>;
  created_at: Date;
}


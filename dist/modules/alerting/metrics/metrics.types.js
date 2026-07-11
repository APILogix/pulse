import { z } from 'zod';
import { UuidSchema, PaginationSchema, AlertSeveritySchema } from '../common.js';
import { AppError } from '../../../shared/errors/app-error.js';
export const MetricGranularitySchema = z.enum(['hour', 'day', 'week', 'month']);
export const MetricsQuerySchema = z.object({
    metricType: z.string().max(50).optional(),
    ruleId: UuidSchema.optional(),
    granularity: MetricGranularitySchema.default('hour'),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(168),
});
//# sourceMappingURL=metrics.types.js.map
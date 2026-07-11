import { z } from 'zod';
export declare const MetricGranularitySchema: z.ZodEnum<{
    week: "week";
    day: "day";
    hour: "hour";
    month: "month";
}>;
export type MetricGranularity = z.infer<typeof MetricGranularitySchema>;
export declare const MetricsQuerySchema: z.ZodObject<{
    metricType: z.ZodOptional<z.ZodString>;
    ruleId: z.ZodOptional<z.ZodString>;
    granularity: z.ZodDefault<z.ZodEnum<{
        week: "week";
        day: "day";
        hour: "hour";
        month: "month";
    }>>;
    from: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    to: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export type MetricsQuery = z.infer<typeof MetricsQuerySchema>;
export interface AlertMetricRow {
    id: string;
    organization_id: string;
    rule_id: string | null;
    metric_type: string;
    value: string;
    bucket_start: Date;
    bucket_end: Date;
    granularity: MetricGranularity;
    labels: Record<string, unknown>;
    created_at: Date;
}
//# sourceMappingURL=metrics.types.d.ts.map
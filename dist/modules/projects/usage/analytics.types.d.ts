/**
 * Project usage analytics types and schemas.
 */
import { z } from "zod";
export declare const UsageGranularitySchema: z.ZodEnum<{
    minute: "minute";
    hourly: "hourly";
    daily: "daily";
}>;
export type UsageGranularity = z.infer<typeof UsageGranularitySchema>;
export declare const UsageAnalyticsQuerySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    from: z.ZodCoercedDate<unknown>;
    to: z.ZodCoercedDate<unknown>;
    granularity: z.ZodDefault<z.ZodEnum<{
        minute: "minute";
        hourly: "hourly";
        daily: "daily";
    }>>;
    environmentId: z.ZodOptional<z.ZodString>;
    apiKeyId: z.ZodOptional<z.ZodString>;
    release: z.ZodOptional<z.ZodString>;
    sdkVersion: z.ZodOptional<z.ZodString>;
    service: z.ZodOptional<z.ZodString>;
    endpoint: z.ZodOptional<z.ZodString>;
    region: z.ZodOptional<z.ZodString>;
    eventType: z.ZodOptional<z.ZodString>;
    severity: z.ZodOptional<z.ZodString>;
    tag: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    cursor: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>;
export type UsageAnalyticsQuery = z.infer<typeof UsageAnalyticsQuerySchema>;
export declare const HeatmapQuerySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    from: z.ZodCoercedDate<unknown>;
    to: z.ZodCoercedDate<unknown>;
    type: z.ZodDefault<z.ZodEnum<{
        hourly: "hourly";
        calendar: "calendar";
        dayOfWeek: "dayOfWeek";
    }>>;
    environmentId: z.ZodOptional<z.ZodString>;
    apiKeyId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>;
export type HeatmapQuery = z.infer<typeof HeatmapQuerySchema>;
export declare const TopListQuerySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    from: z.ZodCoercedDate<unknown>;
    to: z.ZodCoercedDate<unknown>;
    dimension: z.ZodEnum<{
        release: "release";
        service: "service";
        country: "country";
        endpoint: "endpoint";
        sdkVersion: "sdkVersion";
        errorGroup: "errorGroup";
        browser: "browser";
        os: "os";
        device: "device";
    }>;
    environmentId: z.ZodOptional<z.ZodString>;
    apiKeyId: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>>;
export type TopListQuery = z.infer<typeof TopListQuerySchema>;
export declare const ComparisonQuerySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    from: z.ZodCoercedDate<unknown>;
    to: z.ZodCoercedDate<unknown>;
    dimension: z.ZodDefault<z.ZodEnum<{
        apiKey: "apiKey";
        environment: "environment";
    }>>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>>;
export type ComparisonQuery = z.infer<typeof ComparisonQuerySchema>;
export interface UsageTimeSeriesPoint {
    bucket: string;
    totalEvents: number;
    errors: number;
    requests: number;
    transactions: number;
    traces: number;
    spans: number;
    logs: number;
    metrics: number;
    profiles: number;
    aiEvents: number;
    sdkRequests: number;
    activeApiKeys: number;
    activeEnvironments: number;
    activeUsers: number;
    activeMembers: number;
    alertCount: number;
    connectorDeliveries: number;
    failedNotifications: number;
    rateLimitUsage: number;
    latencyMsP50: number | null;
    latencyMsP95: number | null;
    latencyMsP99: number | null;
}
export interface UsageSummary {
    totalEvents: number;
    errors: number;
    requests: number;
    transactions: number;
    traces: number;
    spans: number;
    logs: number;
    metrics: number;
    profiles: number;
    aiEvents: number;
    sdkRequests: number;
    activeApiKeys: number;
    activeEnvironments: number;
    activeUsers: number;
    activeMembers: number;
    alertCount: number;
    connectorDeliveries: number;
    failedNotifications: number;
    rateLimitUsage: number;
    latencyMsP50: number | null;
    latencyMsP95: number | null;
    latencyMsP99: number | null;
}
export interface HeatmapCell {
    x: string;
    y: string;
    value: number;
}
export interface HeatmapData {
    type: "calendar" | "hourly" | "dayOfWeek";
    cells: HeatmapCell[];
}
export interface TopListItem {
    key: string;
    totalEvents: number;
    errors: number;
    requests: number;
}
export interface ComparisonSeries {
    id: string;
    name: string;
    data: UsageTimeSeriesPoint[];
}
export interface MonthlyUsageVsPlan {
    yearMonth: string;
    totalEvents: number;
    totalBytes: number;
    apiKeyRequests: number;
    rateLimitedEvents: number;
    alertNotifications: number;
    activeUsers: number;
    planLimit: number | null;
    usagePercent: number | null;
}
export interface UsageAnalyticsResponse {
    summary: UsageSummary;
    timeSeries: UsageTimeSeriesPoint[];
    hasMore: boolean;
    nextCursor: string | null;
}
//# sourceMappingURL=analytics.types.d.ts.map
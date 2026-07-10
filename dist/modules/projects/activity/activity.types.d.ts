import { z } from "zod";
export declare const ListProjectActivityQuerySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    cursor: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    action: z.ZodOptional<z.ZodString>;
}, z.core.$strip>>;
export type ListProjectActivityQuery = z.infer<typeof ListProjectActivityQuerySchema>;
export interface ProjectActivityItem {
    id: string;
    actorUserId: string | null;
    actorEmail: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    entityName: string | null;
    changedFields: string[] | null;
    status: string;
    isSensitive: boolean;
    metadata: Record<string, unknown>;
    createdAt: Date;
}
export interface ProjectActivityResult {
    data: ProjectActivityItem[];
    meta: {
        hasMore: boolean;
        nextCursor: string | null;
        limit: number;
    };
}
export interface ProjectUsageCounter {
    counterType: string;
    totalValue: number;
    lastPeriodStart: Date | null;
    lastPeriodEnd: Date | null;
    lastFlushedAt: Date | null;
}
export interface HourlyUsage {
    id: string;
    projectId: string;
    organizationId: string;
    bucketHour: Date;
    eventCount: number;
    eventBytes: number;
    categoryCounts: Record<string, number>;
    eventTypeCounts: Record<string, number>;
    createdAt: Date;
}
export interface DailyUsage {
    id: string;
    projectId: string;
    organizationId: string;
    bucketDate: string;
    totalEvents: number;
    totalBytes: number;
    categoryCounts: Record<string, number>;
    eventTypeCounts: Record<string, number>;
    peakEventsPerHour: number;
    createdAt: Date;
}
export interface HourlyUsageDto {
    hour: number;
    eventCount: number;
    eventBytes: number;
    categories: Record<string, number>;
    eventTypes: Record<string, number>;
}
export interface DailyTrendDto {
    date: string;
    totalEvents: number;
    totalBytes: number;
    changePercent: number;
}
export interface HeatmapCellDto {
    hour: number;
    value: number;
    intensity: number;
}
//# sourceMappingURL=activity.types.d.ts.map
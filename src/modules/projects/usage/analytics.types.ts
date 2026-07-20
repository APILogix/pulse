/**
 * Project usage analytics types and schemas.
 */
import { z } from "zod";
import { normalizeObjectKeys } from "../shared/schema-utils.js";
import { UuidSchema } from "../../alerting/types.js";

export const UsageGranularitySchema = z.enum(["minute", "hourly", "daily"]);
export type UsageGranularity = z.infer<typeof UsageGranularitySchema>;

export const UsageAnalyticsQuerySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    granularity: UsageGranularitySchema.default("hourly"),
    environmentId: z.string().uuid().optional(),
    apiKeyId: z.string().uuid().optional(),
    release: z.string().max(100).optional(),
    sdkVersion: z.string().max(100).optional(),
    service: z.string().max(100).optional(),
    endpoint: z.string().max(255).optional(),
    region: z.string().max(100).optional(),
    eventType: z.string().max(50).optional(),
    severity: z.string().max(20).optional(),
    tag: z.string().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(100),
    offset: z.coerce.number().int().min(0).default(0),
    cursor: z.string().max(255).optional(),
  }).refine((data) => data.to >= data.from, {
    message: "to must be after from",
    path: ["to"],
  }),
);
export type UsageAnalyticsQuery = z.infer<typeof UsageAnalyticsQuerySchema>;

export const HeatmapQuerySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    type: z.enum(["calendar", "hourly", "dayOfWeek"]).default("calendar"),
    environmentId: z.string().uuid().optional(),
    apiKeyId: z.string().uuid().optional(),
  }),
);
export type HeatmapQuery = z.infer<typeof HeatmapQuerySchema>;

export const TopListQuerySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    dimension: z.enum([
      "endpoint",
      "service",
      "errorGroup",
      "sdkVersion",
      "country",
      "browser",
      "os",
      "device",
      "release",
    ]),
    environmentId: z.string().uuid().optional(),
    apiKeyId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(10),
  }),
);
export type TopListQuery = z.infer<typeof TopListQuerySchema>;

export const ComparisonQuerySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    dimension: z.enum(["environment", "apiKey"]).default("environment"),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  }),
);
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

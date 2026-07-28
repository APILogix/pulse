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
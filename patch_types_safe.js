import fs from 'fs';
import path from 'path';

const typesPath = path.resolve('src/modules/projects/types.ts');

const newTypes = `
// --- New Types for Phase 4 ---
export enum ProjectMemberRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  DEVELOPER = 'developer',
  VIEWER = 'viewer',
}

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  organizationId: string;
  role: ProjectMemberRole;
  status: string;
  invitedBy: string | null;
  invitedAt: Date | null;
  joinedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectSettings {
  id: string;
  projectId: string;
  organizationId: string;
  retentionDays: number;
  maxEventsPerSecond: number;
  autoArchive: boolean;
  alertingEnabled: boolean;
  ingestionEnabled: boolean;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
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

export interface ProjectOverviewDto {
  project: any;
  settings: ProjectSettings;
  memberCount: number;
  apiKeyCount: number;
  usage: {
    totalEventsToday: number;
    totalBytesToday: number;
    peakHour: number;
    currentHourEvents: number;
    categoryBreakdown: Record<string, number>;
    eventTypeBreakdown: Record<string, number>;
    hourlyBreakdown: HourlyUsageDto[];
    dailyTrend: DailyTrendDto[];
    heatmapData: HeatmapCellDto[];
  };
}
`;

let content = fs.readFileSync(typesPath, 'utf8');
if (!content.includes('ProjectMemberRole')) {
  fs.appendFileSync(typesPath, newTypes);
  console.log('Appended new types to types.ts');
} else {
  console.log('Types already appended');
}

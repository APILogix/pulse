export type ErrorGroupStatus = 'OPEN' | 'RESOLVED' | 'IGNORED' | 'REGRESSED';

export interface ErrorGroup {
  id: string;
  projectId: string;
  fingerprint: string;
  status: ErrorGroupStatus;
  occurrenceCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  firstEventId: string;
  latestEventId: string;
  highestSeverity: string;
  latestSeverity: string;
  isRegression: boolean;
  regressionCount: number;
  lastRegressedAt: Date | null;
  latestRelease: string | null;
  latestSdkVersion: string | null;
  latestApplicationVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateErrorGroupParams {
  projectId: string;
  fingerprint: string;
  eventId: string;
  severity: string;
  release?: string;
  sdkVersion?: string;
  applicationVersion?: string;
}

export interface UpdateErrorGroupParams {
  projectId: string;
  fingerprint: string;
  eventId: string;
  severity: string;
  release?: string;
  sdkVersion?: string;
  applicationVersion?: string;
}

export interface ErrorGroupEventRecord {
  id: string;
  organization_id: string;
  project_id: string;
  error_group_id: string;
  event_id: string;
  fingerprint: string;
  message: string;
  error_name: string;
  severity: string;
  timestamp: Date;
  payload: any;
}

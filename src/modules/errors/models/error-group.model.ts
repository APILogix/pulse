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

  lastErrorMessage: string | null;
  lastErrorName: string | null;
  lastStatusCode: number | null;
  lastTraceId: string | null;
  lastRequestId: string | null;

  mergedInto: string | null;
  isMerged: boolean;
  version: number;

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
  api_key_name?: string;
  environment?: string;
  error_group_id: string;
  event_id: string;
  request_id?: string | null;
  trace_id?: string | null;
  span_id?: string | null;
  parent_span_id?: string | null;
  session_id?: string | null;
  user_id?: string | null;
  fingerprint: string;
  error_name: string;
  message: string;
  severity: string;
  mechanism?: string | null;
  handled?: boolean | null;
  method?: string | null;
  route?: string | null;
  url?: string | null;
  status_code?: number | null;
  status_text?: string | null;
  stack_frames?: any;
  breadcrumbs?: any;
  context?: any;
  service?: string | null;
  server_name?: string | null;
  release?: string | null;
  sdk_name?: string | null;
  sdk_version?: string | null;
  application_name?: string | null;
  application_version?: string | null;
  tags?: any;
  extra?: any;
  metadata?: any;
  ai_response?: any;
  timestamp: Date;
  occurred_at?: Date;
  payload: any;
}

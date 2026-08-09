export type ErrorGroupStatus = 'OPEN' | 'RESOLVED' | 'IGNORED' | 'ARCHIVED';

export interface ErrorGroup {
  id: string;
  publicId?: string;
  organizationId: string;
  projectId: string;
  fingerprint: string;
  fingerprintVersion: number;
  status: ErrorGroupStatus;
  occurrenceCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  firstEventId: string;
  latestEventId: string;
  latestEventOccurredAt: Date | null;
  highestSeverity: string;
  latestSeverity: string;
  regressionCount: number;
  lastRegressedAt: Date | null;
  latestRelease: string | null;
  latestSdkVersion: string | null;
  latestApplicationVersion: string | null;
  latestEnvironment: string | null;
  latestService: string | null;
  resolvedAt: Date | null;
  resolvedRelease: string | null;
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
  organizationId?: string;
  projectId: string;
  fingerprint: string;
  fingerprintVersion?: number;
  eventId: string;
  severity: string;
  release?: string;
  sdkVersion?: string;
  applicationVersion?: string;
  environment?: string;
  service?: string;
  occurredAt?: Date;
}

export interface UpdateErrorGroupParams extends CreateErrorGroupParams {}

export interface ErrorGroupEventRecord {
  id: string;
  organization_id: string;
  project_id: string;
  api_key_name?: string;
  environment?: string;
  error_group_id?: string | null;
  event_id: string;
  request_id?: string | null;
  trace_id?: string | null;
  span_id?: string | null;
  parent_span_id?: string | null;
  session_id?: string | null;
  user_id?: string | null;
  fingerprint: string;
  fingerprint_version?: number;
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
  stack_frames?: unknown;
  breadcrumbs?: unknown;
  context?: unknown;
  service?: string | null;
  server_name?: string | null;
  release?: string | null;
  sdk_name?: string | null;
  sdk_version?: string | null;
  application_name?: string | null;
  application_version?: string | null;
  tags?: unknown;
  extra?: unknown;
  metadata?: unknown;
  ai_response?: unknown;
  occurred_at: Date;
  timestamp?: Date;
  payload: unknown;
}

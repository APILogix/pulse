/**
 * Enterprise Alert Notification Formatter.
 *
 * Extracts and normalizes rich diagnostic context (Route, Latency, Threshold,
 * Difference, Percentile, Stack frames, Trace ID, Public IDs, Environment, Project)
 * and builds structured NotificationPayload and Sentinel Mono emails for alert delivery.
 */
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import {
  latencyAlertTemplate,
  errorAlertTemplate,
  errorSpikeTemplate,
  alertFiringTemplate,
  alertResolvedTemplate,
  alertEscalatedTemplate,
  type AlertSeverity,
  type EmailTemplate,
  type DataRow,
} from '../../../shared/email/index.js';
import type { AlertDecisionCandidate } from '../decision/decision.engine.js';
import type { NotificationPayload } from '../../connectors/types.js';

const formatterLogger = logger.child({ component: 'alert-notification-formatter' });

export interface AlertNotificationContract {
  type: 'alert.firing' | 'alert.resolved' | 'alert.escalated';
  alert: {
    id: string;
    publicId?: string;
    ruleId: string;
    ruleName: string;
    severity: string;
    status: string;
    startedAt: string;
  };
  project: {
    organizationId: string;
    organizationSlug?: string;
    organizationName?: string;
    projectId: string;
    projectSlug?: string;
    projectName?: string;
    environment: string;
    serviceName?: string;
    release?: string;
  };
  event: {
    type: string;
    publicId?: string;
    eventId?: string;
    occurredAt: string;
  };
  correlation: {
    requestId?: string;
    traceId?: string;
    tracePublicId?: string;
    spanId?: string;
    spanPublicId?: string;
  };
  diagnostic: LatencyDiagnostic | ErrorDiagnostic | Record<string, unknown>;
  actions: {
    viewAlert: string;
    viewEvent?: string;
    viewRequest?: string;
    viewError?: string;
    viewTrace?: string;
    acknowledge?: string;
    silence?: string;
    preferences?: string;
  };
}

export interface LatencyDiagnostic {
  kind: 'latency';
  percentile: string;
  observedValue: number;
  observedFormatted: string;
  thresholdValue: number;
  thresholdFormatted: string;
  unit: string;
  differenceMs?: number;
  differenceFormatted?: string;
  differencePercent?: number;
  aboveThresholdFormatted?: string;
  evaluationWindow?: string;
  method?: string;
  route?: string;
  statusCode?: number | string;
  durationMs?: number;
  responseSizeBytes?: number;
  aiInsight?: {
    text: string;
    confidence?: number;
  };
}

export interface ErrorDiagnostic {
  kind: 'error';
  exceptionType?: string;
  message: string;
  fingerprint?: string;
  handled?: boolean;
  mechanism?: string;
  method?: string;
  route?: string;
  url?: string;
  statusCode?: number | string;
  durationMs?: number;
  primaryFrame?: {
    file: string;
    line?: number | string;
    column?: number | string;
    function?: string;
    inApp?: boolean;
    preContext?: string[];
    contextLine?: string;
    postContext?: string[];
  };
  sourceContext?: string;
  occurrences?: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
  framework?: string;
  aiInsight?: {
    text: string;
    confidence?: number;
  };
}

export interface ExtractedAlertContext {
  ruleName: string;
  ruleId: string;
  severity: AlertSeverity;
  category: string;
  alertKey: string;
  alertEventId?: string | undefined;
  kind: 'fired' | 'recovered';
  isLatency: boolean;
  isError: boolean;
  isErrorRate: boolean;
  observedValue?: number | null | undefined;
  thresholdValue?: number | null | undefined;
  observedFormatted?: string | undefined;
  thresholdFormatted?: string | undefined;
  differenceMs?: number | undefined;
  differencePercent?: number | undefined;
  differenceFormatted?: string | undefined;
  aboveThresholdFormatted?: string | undefined;
  evaluationWindow?: string | undefined;
  endpoint?: string | undefined;
  method?: string | undefined;
  statusCode?: number | string | undefined;
  durationMs?: number | undefined;
  timeTakenFormatted?: string | undefined;
  occurredAt: Date;
  occurredAtFormatted: string;
  traceId?: string | undefined;
  tracePublicId?: string | undefined;
  spanId?: string | undefined;
  spanPublicId?: string | undefined;
  requestId?: string | undefined;
  eventPublicId?: string | undefined;
  eventId?: string | undefined;
  clientIp?: string | undefined;
  userAgent?: string | undefined;
  errorMessage?: string | undefined;
  errorType?: string | undefined;
  fingerprint?: string | undefined;
  handled?: boolean | undefined;
  mechanism?: string | undefined;
  sourceFrame?: string | undefined;
  sourceFunction?: string | undefined;
  sourceContext?: string | undefined;
  occurrences?: number | undefined;
  firstSeenAt?: string | undefined;
  lastSeenAt?: string | undefined;
  release?: string | undefined;
  framework?: string | undefined;
  stackSnippet?: string | undefined;
  projectId?: string | null | undefined;
  projectSlug?: string | null | undefined;
  projectName?: string | null | undefined;
  environment?: string | null | undefined;
  service?: string | null | undefined;
  organizationId: string;
  orgSlug?: string | null | undefined;
  orgName?: string | null | undefined;
  source: string;
  summary: string;
  subject: string;
  fields: Array<{ label: string; value: string; short?: boolean | undefined }>;
  alertUrl?: string | undefined;
  traceUrl?: string | undefined;
  requestUrl?: string | undefined;
  errorUrl?: string | undefined;
  eventUrl?: string | undefined;
  acknowledgeUrl?: string | undefined;
  silenceUrl?: string | undefined;
  preferencesUrl?: string | undefined;
  escalationStep?: number | undefined;
  policyName?: string | undefined;
  aiInsight?: { text: string; confidence?: number } | undefined;
  rawEvidence: Record<string, unknown>;
  rawPolicy?: Record<string, unknown> | undefined;
}

/** Format milliseconds or numbers cleanly. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return 'n/a';
  if (ms >= 1000) {
    const s = ms / 1000;
    return `${s >= 10 ? Math.round(s) : s.toFixed(2)}s`;
  }
  return `${Math.round(ms).toLocaleString('en-US')} ms`;
}

/** Format numbers with units or percentages based on field/category. */
export function formatMetricValue(value: number | null | undefined, fieldHint = ''): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'n/a';
  const hint = fieldHint.toLowerCase();
  if (hint.includes('latency') || hint.includes('duration') || hint.includes('time') || hint.includes('_ms')) {
    return formatDuration(value);
  }
  if (hint.includes('rate') || hint.includes('percent') || hint.includes('ratio') || (value > 0 && value <= 1 && hint.includes('error'))) {
    const pct = value <= 1 && !hint.includes('100') ? value * 100 : value;
    return `${pct.toFixed(pct % 1 === 0 ? 0 : 1)}%`;
  }
  if (hint.includes('cpu') || hint.includes('memory') || hint.includes('disk') || hint.includes('usage')) {
    return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
  }
  return value.toLocaleString('en-US');
}

/** Format timestamp in UTC and human-readable format. */
export function formatTimestamp(date: Date | string | number | undefined): string {
  if (!date) return new Date().toUTCString();
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return new Date().toUTCString();
  return d.toUTCString().replace('GMT', 'UTC');
}

/** Get public base URL for links. */
export function getAppBaseUrl(): string {
  const base = env.FRONTEND_URL || env.APP_URL || 'http://localhost:5173';
  return base.replace(/\/+$/, '');
}

/** Normalize local / server file paths into application-relative paths. */
export function normalizeFilePath(filepath: unknown): string {
  if (typeof filepath !== 'string' || !filepath.trim()) return '';
  let p = filepath.replace(/\\/g, '/').trim();

  // If path contains /src/ or starts with src/, extract from src/
  const srcIdx = p.indexOf('/src/');
  if (srcIdx !== -1) {
    p = p.slice(srcIdx + 1);
  } else {
    const libIdx = p.indexOf('/lib/');
    if (libIdx !== -1) {
      p = p.slice(libIdx + 1);
    } else {
      p = p.replace(/^[a-zA-Z]:\/(?:Users|home|root|var|app|workspace|runner|actions-runner)\/[^/]+\/[^/]+\//i, '');
      p = p.replace(/^[a-zA-Z]:\/[^/]+\//i, '');
      p = p.replace(/^\/(?:Users|home|root|var|app|workspace|runner)\/[^/]+\/[^/]+\//i, '');
    }
  }

  p = p.replace(/^webpack:\/\/[^/]*\//i, '');
  p = p.replace(/^(?:\.\/|\/)+/, '');
  p = p.replace(/^node_modules\//i, '');
  return p;
}

export interface ExtractedSourceFrame {
  location: string;
  functionName?: string | undefined;
  sourceContext?: string | undefined;
}

/** Select the most relevant in-app stack frame and excerpt. */
export function extractPrimarySourceFrame(
  stackRaw: unknown,
  framesRaw: unknown,
): ExtractedSourceFrame | undefined {
  // 1. Try structured frames
  if (Array.isArray(framesRaw) && framesRaw.length > 0) {
    const validFrames = framesRaw.filter((f) => f && typeof f === 'object') as Record<string, unknown>[];
    const inAppFrame = validFrames.find((f) => {
      const isInternal = /node_modules|node:internal|@sentry|@fastify|fastify\/lib|express\/lib/i.test(
        String(f.filename || f.file || f.module || ''),
      );
      return !isInternal && (f.inApp === true || f.in_app === true || f.inApp === undefined);
    }) || validFrames[0];

    if (inAppFrame) {
      const file = normalizeFilePath(inAppFrame.filename || inAppFrame.file || inAppFrame.module);
      const line = inAppFrame.lineno ?? inAppFrame.lineNumber ?? inAppFrame.line;
      const col = inAppFrame.colno ?? inAppFrame.column;
      const fn = inAppFrame.function || inAppFrame.functionName || inAppFrame.fn;
      const location = file ? `${file}${line ? `:${line}` : ''}${col ? `:${col}` : ''}` : '';

      let sourceContext: string | undefined;
      const pre = Array.isArray(inAppFrame.preContext ?? inAppFrame.pre_context)
        ? ((inAppFrame.preContext ?? inAppFrame.pre_context) as string[])
        : [];
      const curr = inAppFrame.contextLine ?? inAppFrame.context_line;
      const post = Array.isArray(inAppFrame.postContext ?? inAppFrame.post_context)
        ? ((inAppFrame.postContext ?? inAppFrame.post_context) as string[])
        : [];
      if (curr || pre.length > 0 || post.length > 0) {
        const lines: string[] = [];
        pre.forEach((l) => lines.push(`  ${l}`));
        if (curr) lines.push(`> ${curr}`);
        post.forEach((l) => lines.push(`  ${l}`));
        sourceContext = lines.join('\n');
      }

      if (location) {
        return {
          location,
          functionName: typeof fn === 'string' && fn.trim() ? fn.trim() : undefined,
          sourceContext,
        };
      }
    }
  }

  // 2. Try parsing stack string
  if (typeof stackRaw === 'string' && stackRaw.trim()) {
    const lines = stackRaw.split('\n');
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed.startsWith('at ') && !trimmed.startsWith('File "')) continue;
      if (/node_modules|node:internal|@sentry|@fastify|fastify\/lib|express\/lib/i.test(trimmed)) continue;

      const match = trimmed.match(/^at\s+(?:(async\s+)?([^\s(]+)\s+\((.+)\)|(.+))$/);
      if (match) {
        const fn = match[2] || undefined;
        const loc = match[3] || match[4] || '';
        const locParts = loc.match(/^(.*?)(?::(\d+))?(?::(\d+))?$/);
        if (locParts) {
          const file = normalizeFilePath(locParts[1]);
          const line = locParts[2];
          const col = locParts[3];
          if (file) {
            return {
              location: `${file}${line ? `:${line}` : ''}${col ? `:${col}` : ''}`,
              functionName: fn && fn !== 'Object.<anonymous>' && fn !== '<anonymous>' ? fn : undefined,
            };
          }
        }
      }
    }
  }

  return undefined;
}

/** Extract all diagnostic fields from candidate, evidence, event, payload. */
export function extractAlertContext(input: {
  candidate?: Partial<AlertDecisionCandidate> | undefined;
  payload?: Record<string, unknown> | undefined;
  alertKey?: string | undefined;
  alertEventId?: string | undefined;
  organizationId?: string | undefined;
  projectId?: string | null | undefined;
  environment?: string | null | undefined;
  severity?: string | undefined;
  ruleId?: string | undefined;
  escalationStep?: number | undefined;
}): ExtractedAlertContext {
  const startedTime = Date.now();
  try {
    const candidate = input.candidate ?? {};
    const payload = input.payload ?? {};
    const evidence = (candidate.evidence ?? payload.evidence ?? {}) as Record<string, unknown>;
    const values = (evidence.values ?? payload.values ?? {}) as Record<string, unknown>;
    const labels = (evidence.labels ?? candidate.labels ?? payload.labels ?? {}) as Record<string, unknown>;
    const event = (evidence.event ?? {}) as Record<string, unknown>;
    const record = (event.record ?? event.data ?? event) as Record<string, unknown>;
    const policy = (candidate.policy ?? payload.policy ?? {}) as Record<string, unknown>;
    const annotations = (candidate.annotations ?? payload.annotations ?? {}) as Record<string, unknown>;
    const metadata = (payload.metadata ?? {}) as Record<string, unknown>;

    const organizationId = String(
      candidate.organizationId || payload.organizationId || input.organizationId || '',
    );
    const projectId = candidate.projectId ?? (payload.projectId as string | null) ?? input.projectId ?? null;
    const environment = candidate.environment
      ?? (payload.environment as string | null)
      ?? (labels.environment as string | null)
      ?? (record.environment as string | null)
      ?? (metadata.environment as string | null)
      ?? input.environment
      ?? null;
    const service = candidate.service
      ?? (payload.service as string | null)
      ?? (labels.service as string | null)
      ?? (record.service as string | null)
      ?? (metadata.service as string | null)
      ?? null;
    const release = (record.release as string | undefined)
      ?? (event.release as string | undefined)
      ?? (payload.release as string | undefined)
      ?? (metadata.release as string | undefined);

    const rawSeverity = String(
      candidate.policy?.severity || payload.severity || (candidate as any).severity || input.severity || 'error',
    ).toLowerCase();
    const severity: AlertSeverity =
      rawSeverity === 'critical' || rawSeverity === 'fatal'
        ? 'critical'
        : rawSeverity === 'warning'
          ? 'warning'
          : rawSeverity === 'info' || rawSeverity === 'debug'
            ? 'info'
            : 'error';

    const kind: 'fired' | 'recovered' = (candidate.kind ?? payload.kind) === 'recovered' ? 'recovered' : 'fired';
    const ruleId = String(candidate.policy?.ruleId || payload.ruleId || input.ruleId || '');
    const ruleName = String(
      (candidate.policy as any)?.ruleName
      || payload.ruleName
      || annotations.title
      || (policy as any).name
      || (policy as any).ruleName
      || (ruleId ? `Rule ${ruleId.slice(0, 8)}` : 'Alert Rule'),
    ).replace(/^(Alert|Recovered):\s*/i, '').trim();

    // Extract Route / Endpoint
    const endpoint = String(
      candidate.endpoint
      || payload.endpoint
      || record.route
      || record.endpoint
      || record.url
      || record.path
      || event.route
      || event.endpoint
      || event.path
      || labels.route
      || labels.endpoint
      || values.route
      || (metadata.endpoint as string | undefined)
      || '',
    ).trim() || undefined;

    // Extract HTTP Method
    const method = String(
      record.method
      || record.httpMethod
      || event.method
      || (record.req as Record<string, unknown> | undefined)?.method
      || labels.method
      || (metadata.method as string | undefined)
      || '',
    ).trim() || undefined;

    // Extract HTTP Status Code
    const rawStatus = (values.requests as Record<string, unknown> | undefined)?.status_code
      ?? record.statusCode
      ?? record.status_code
      ?? event.statusCode
      ?? event.status_code
      ?? (values.status_code as number | undefined)
      ?? (metadata.statusCode as number | undefined);
    const statusCode = rawStatus !== undefined && rawStatus !== null && String(rawStatus).trim() !== ''
      ? Number(rawStatus) || String(rawStatus)
      : undefined;

    // Extract Latency / Duration
    const rawObserved = candidate.observedValue
      ?? (typeof payload.observedValue === 'number' ? payload.observedValue : null)
      ?? (typeof metadata.observedValue === 'number' ? metadata.observedValue : null)
      ?? (values.latency_ms as number | undefined)
      ?? (values.duration_ms as number | undefined)
      ?? (record.latencyMs as number | undefined)
      ?? (record.durationMs as number | undefined)
      ?? (record.latency as number | undefined)
      ?? (record.duration as number | undefined);
    const observedValue = typeof rawObserved === 'number' && Number.isFinite(rawObserved) ? rawObserved : null;

    const rawThreshold = candidate.thresholdValue
      ?? (typeof payload.thresholdValue === 'number' ? payload.thresholdValue : null)
      ?? (typeof metadata.thresholdValue === 'number' ? metadata.thresholdValue : null);
    const thresholdValue = typeof rawThreshold === 'number' && Number.isFinite(rawThreshold) ? rawThreshold : null;

    // Category and condition checks
    const conditionPaths = candidate.conditionFieldPaths
      ?? (Array.isArray(policy.conditions) ? policy.conditions.map((c: any) => c.field_path) : []);
    const category = candidate.category
      || (payload.category as string)
      || (conditionPaths.some((p: string) => String(p).includes('latency') || String(p).includes('duration')) ? 'performance' : 'all');

    const isLatency = category === 'performance'
      || /latency|duration|response_time|p95|p99/i.test(ruleName)
      || conditionPaths.some((p: string) => /latency|duration|response_time/i.test(String(p)));

    const isErrorRate = conditionPaths.some((p: string) => /error_rate|error-rate/i.test(String(p)));
    const isError = !isLatency && (
      category === 'errors'
      || category === 'error'
      || event.type === 'error'
      || /error|5xx|exception|fail|crash|unhandled/i.test(ruleName)
      || conditionPaths.some((p: string) => /error|5xx|unhandled|fatal/i.test(String(p)))
    );

    // Formatted observed & threshold
    const fieldHint = conditionPaths[0] || (isLatency ? 'requests.latency_ms' : isErrorRate ? 'error_rate' : '');
    const observedFormatted = (payload.observedFormatted as string | undefined)
      || (metadata.observedFormatted as string | undefined)
      || (observedValue !== null ? formatMetricValue(observedValue, fieldHint) : undefined);
    const thresholdFormatted = (payload.thresholdFormatted as string | undefined)
      || (metadata.thresholdFormatted as string | undefined)
      || (thresholdValue !== null ? formatMetricValue(thresholdValue, fieldHint) : undefined);
    const durationMs = observedValue ?? (typeof payload.durationMs === 'number' ? payload.durationMs : undefined);
    const timeTakenFormatted = (payload.timeTakenFormatted as string | undefined)
      || (metadata.timeTakenFormatted as string | undefined)
      || (durationMs !== undefined ? formatDuration(durationMs) : undefined);

    // Latency Difference & Percentage
    let differenceMs: number | undefined;
    let differencePercent: number | undefined;
    let differenceFormatted: string | undefined;
    let aboveThresholdFormatted: string | undefined;
    if (observedValue !== null && thresholdValue !== null && thresholdValue > 0) {
      differenceMs = Math.round((observedValue - thresholdValue) * 100) / 100;
      differencePercent = Math.round(((observedValue - thresholdValue) / thresholdValue) * 100);
      const diffSign = differenceMs >= 0 ? '+' : '';
      const pctSign = differencePercent >= 0 ? '+' : '';
      differenceFormatted = `${diffSign}${formatDuration(Math.abs(differenceMs))}`;
      aboveThresholdFormatted = `${diffSign}${formatDuration(Math.abs(differenceMs))} (${pctSign}${differencePercent}%)`;
    }

    // Evaluation Window
    const evaluationWindow = (policy.evaluationIntervalSeconds ? `${Math.round(Number(policy.evaluationIntervalSeconds) / 60)} min` : undefined)
      || (payload.window as string | undefined)
      || (metadata.window as string | undefined);

    // Extract Identifiers & Correlations
    const traceId = String(
      payload.traceId
      || metadata.traceId
      || event.traceId
      || event.trace_id
      || record.traceId
      || record.trace_id
      || (event.tags as Record<string, unknown> | undefined)?.trace_id
      || (record.tags as Record<string, unknown> | undefined)?.trace_id
      || '',
    ).trim() || undefined;

    const tracePublicId = String(
      (payload.correlation as Record<string, unknown> | undefined)?.tracePublicId
      || payload.tracePublicId
      || metadata.tracePublicId
      || event.tracePublicId
      || record.tracePublicId
      || '',
    ).trim() || undefined;

    const spanId = String(
      payload.spanId
      || metadata.spanId
      || event.spanId
      || event.span_id
      || record.spanId
      || record.span_id
      || '',
    ).trim() || undefined;

    const spanPublicId = String(
      (payload.correlation as Record<string, unknown> | undefined)?.spanPublicId
      || payload.spanPublicId
      || metadata.spanPublicId
      || event.spanPublicId
      || record.spanPublicId
      || '',
    ).trim() || undefined;

    const requestId = String(
      payload.requestId
      || metadata.requestId
      || record.requestId
      || record.request_id
      || event.requestId
      || event.request_id
      || '',
    ).trim() || undefined;

    const eventPublicId = String(
      (payload.event as Record<string, unknown> | undefined)?.publicId
      || payload.eventPublicId
      || metadata.eventPublicId
      || (event as any).publicId
      || (record as any).publicId
      || '',
    ).trim() || undefined;

    const eventId = String(
      (payload.event as Record<string, unknown> | undefined)?.eventId
      || payload.eventId
      || (event as any).eventId
      || (event as any).id
      || '',
    ).trim() || undefined;

    const fingerprint = String(
      (payload.diagnostic as Record<string, unknown> | undefined)?.fingerprint
      || payload.fingerprint
      || metadata.fingerprint
      || record.fingerprint
      || event.fingerprint
      || '',
    ).trim() || undefined;

    const clientIp = String(
      payload.clientIp
      || metadata.clientIp
      || record.ip
      || record.clientIp
      || record.client_ip
      || event.ip
      || (record.req as Record<string, unknown> | undefined)?.ip
      || record.remoteAddress
      || '',
    ).trim() || undefined;

    const userAgent = String(
      payload.userAgent
      || metadata.userAgent
      || record.userAgent
      || record.user_agent
      || event.userAgent
      || ((record.req as Record<string, unknown> | undefined)?.headers as Record<string, unknown> | undefined)?.['user-agent']
      || '',
    ).trim() || undefined;

    // Extract Error Details & Stack Normalization
    const rawErrorMessage = (values.errors as Record<string, unknown> | undefined)?.message
      ?? (values.logs as Record<string, unknown> | undefined)?.message
      ?? record.message
      ?? record.error
      ?? record.exception
      ?? event.message
      ?? (metadata.errorMessage as string | undefined)
      ?? '';
    const errorMessage = typeof rawErrorMessage === 'string' && rawErrorMessage.trim() ? rawErrorMessage.trim() : undefined;
    const errorType = (typeof record.errorType === 'string' ? record.errorType : typeof record.name === 'string' ? record.name : (metadata.errorType as string | undefined))
      || (isError && errorMessage ? 'Error' : undefined);

    const handled = typeof record.handled === 'boolean'
      ? record.handled
      : typeof (event as any).handled === 'boolean'
        ? (event as any).handled
        : undefined;
    const mechanism = typeof record.mechanism === 'string' ? record.mechanism : typeof (event as any).mechanism === 'string' ? (event as any).mechanism : undefined;

    const primarySource = extractPrimarySourceFrame(
      record.stack ?? event.stack ?? metadata.stack,
      record.stackFrames ?? record.stack_frames ?? record.frames ?? event.stack_frames,
    );
    const sourceFrame = primarySource?.location;
    const sourceFunction = primarySource?.functionName;
    const sourceContext = primarySource?.sourceContext;
    const stackSnippet = typeof record.stack === 'string' ? record.stack.slice(0, 500) : undefined;

    const occurrences = typeof record.occurrences === 'number' ? record.occurrences : typeof payload.occurrences === 'number' ? payload.occurrences : undefined;
    const firstSeenAt = typeof record.firstSeenAt === 'string' ? record.firstSeenAt : typeof payload.firstSeenAt === 'string' ? payload.firstSeenAt : undefined;
    const lastSeenAt = typeof record.lastSeenAt === 'string' ? record.lastSeenAt : typeof payload.lastSeenAt === 'string' ? payload.lastSeenAt : undefined;
    const framework = typeof record.framework === 'string' ? record.framework : undefined;

    // Timestamp
    const rawObservedAt = candidate.observedAt || payload.occurredAt || event.timestamp || record.timestamp || new Date();
    const occurredAt = rawObservedAt instanceof Date ? rawObservedAt : new Date(rawObservedAt as string | number);
    const occurredAtFormatted = formatTimestamp(occurredAt);

    const alertKey = input.alertKey || (candidate as any).alertKey || (payload.alertKey as string) || (metadata.alertKey as string) || 'default';
    const alertEventId = input.alertEventId || (payload.alertEventId as string) || (metadata.alertEventId as string) || undefined;

    // Extract Organization & Project Identity (Clean single name or slug resolution)
    const candidateAny = candidate as Record<string, unknown>;
    const rawOrgName = (candidateAny.orgName as string) || (evidence.orgName as string) || (payload.orgName as string) || (metadata.orgName as string);
    const rawOrgSlug = (candidateAny.orgSlug as string) || (evidence.orgSlug as string) || (payload.orgSlug as string) || (metadata.orgSlug as string);
    const orgName = rawOrgName && rawOrgName.trim() ? rawOrgName.trim() : undefined;
    const orgSlug = rawOrgSlug && rawOrgSlug.trim() ? rawOrgSlug.trim() : undefined;
    const resolvedOrgDisplay = orgName || orgSlug || (organizationId ? `Org ${organizationId.slice(0, 8)}` : '');

    const rawProjectName = (candidateAny.projectName as string) || (evidence.projectName as string) || (payload.projectName as string) || (metadata.projectName as string);
    const rawProjectSlug = (candidateAny.projectSlug as string) || (evidence.projectSlug as string) || (payload.projectSlug as string) || (metadata.projectSlug as string);
    const projectName = rawProjectName && rawProjectName.trim() ? rawProjectName.trim() : undefined;
    const projectSlug = rawProjectSlug && rawProjectSlug.trim() ? rawProjectSlug.trim() : undefined;
    const resolvedProjectDisplay = projectName || projectSlug || (projectId ? `Project ${projectId.slice(0, 8)}` : '');

    const source = candidate.source || (payload.source as string) || 'telemetry';

    // Deep Links (Trace URL validated only when valid identifier exists)
    const baseUrl = getAppBaseUrl();
    const validTraceIdent = (tracePublicId || traceId || '').trim();
    const hasValidTrace = validTraceIdent && validTraceIdent !== 'undefined' && validTraceIdent !== 'null';
    const traceUrl = projectId && hasValidTrace
      ? `${baseUrl}/projects/${encodeURIComponent(projectId)}/traces/${encodeURIComponent(validTraceIdent)}`
      : undefined;

    if (hasValidTrace) {
      formatterLogger.debug({ traceId: validTraceIdent, traceUrl }, 'trace_link_generation_success');
    }

    const requestUrl = projectId && (requestId || eventPublicId || eventId)
      ? `${baseUrl}/projects/${encodeURIComponent(projectId)}/requests/${encodeURIComponent(eventPublicId || requestId || eventId || '')}`
      : undefined;

    const errorUrl = projectId && (fingerprint || eventPublicId || eventId)
      ? `${baseUrl}/projects/${encodeURIComponent(projectId)}/errors/${encodeURIComponent(fingerprint || eventPublicId || eventId || '')}`
      : undefined;

    const eventUrl = requestUrl || errorUrl;

    const alertUrl = projectId
      ? `${baseUrl}/projects/${encodeURIComponent(projectId)}/alerts/${encodeURIComponent(alertKey)}`
      : `${baseUrl}/alerts/${encodeURIComponent(alertKey)}`;
    const acknowledgeUrl = `${alertUrl}?action=ack`;
    const silenceUrl = `${alertUrl}?action=silence`;
    const preferencesUrl = `${baseUrl}/settings/notifications`;

    // Scope string for subjects
    const scopeParts: string[] = [];
    if (resolvedProjectDisplay) scopeParts.push(resolvedProjectDisplay);
    if (environment) scopeParts.push(`(${environment})`);
    const scopeStr = scopeParts.length > 0 ? scopeParts.join(' ') : (resolvedOrgDisplay || '');

    const escalationStep = input.escalationStep || (payload.escalationStep as number | undefined) || undefined;

    // Subject line construction conforming to Section 8
    let subject: string;
    if (kind === 'recovered') {
      subject = `[RESOLVED] ${ruleName}${scopeStr ? ` — ${scopeStr}` : ''}`;
    } else if (escalationStep) {
      subject = `[ESCALATED S${escalationStep} · ${severity.toUpperCase()}] ${ruleName}${scopeStr ? ` — ${scopeStr}` : ''}`;
    } else if (isLatency) {
      subject = `[FIRING · ${severity.toUpperCase()}] ${ruleName}${scopeStr ? ` — ${scopeStr}` : ''}`;
    } else if (isError) {
      const errorSubjectTitle = errorType && errorType !== 'Error' ? errorType : ruleName;
      subject = `[FIRING · ${severity.toUpperCase()}] ${errorSubjectTitle}${scopeStr ? ` — ${scopeStr}` : ''}`;
    } else {
      subject = `[FIRING · ${severity.toUpperCase()}] ${ruleName}${scopeStr ? ` — ${scopeStr}` : ''}`;
    }

    // Summary computation
    let summary: string;
    if (kind === 'recovered') {
      summary = `${ruleName} has recovered and is no longer breaching threshold${endpoint ? ` on ${endpoint}` : ''}.`;
    } else if (isLatency && endpoint && observedFormatted && thresholdFormatted) {
      summary = `High latency detected on ${method ? `${method} ` : ''}${endpoint}. Measured response time reached ${observedFormatted}, exceeding configured threshold of ${thresholdFormatted}.`;
    } else if (isLatency && observedFormatted) {
      summary = `Response time reached ${observedFormatted}${thresholdFormatted ? ` (threshold ${thresholdFormatted})` : ''}${endpoint ? ` on ${endpoint}` : ''}.`;
    } else if (isError && errorMessage) {
      summary = `Error occurred${endpoint ? ` on ${endpoint}` : ''}: ${errorMessage}`;
    } else if (observedFormatted && thresholdFormatted) {
      summary = `${ruleName} breached threshold: measured ${observedFormatted} vs threshold of ${thresholdFormatted}.`;
    } else {
      summary = `${ruleName} triggered an alert notification${endpoint ? ` on ${endpoint}` : ''}.`;
    }

    // Structured fields for connectors
    const fields: Array<{ label: string; value: string; short?: boolean }> = [];
    fields.push({ label: 'Rule', value: ruleName, short: true });
    fields.push({ label: 'Severity', value: severity.toUpperCase(), short: true });
    if (endpoint) fields.push({ label: 'Route', value: endpoint, short: true });
    if (method) fields.push({ label: 'Method', value: method.toUpperCase(), short: true });
    if (statusCode !== undefined) fields.push({ label: 'Status Code', value: String(statusCode), short: true });
    if (timeTakenFormatted) fields.push({ label: 'Time Taken', value: timeTakenFormatted, short: true });
    if (thresholdFormatted) fields.push({ label: 'Threshold', value: thresholdFormatted, short: true });
    if (aboveThresholdFormatted) fields.push({ label: 'Above Threshold', value: aboveThresholdFormatted, short: true });
    if (resolvedProjectDisplay) fields.push({ label: 'Project', value: resolvedProjectDisplay, short: true });
    if (environment) fields.push({ label: 'Environment', value: environment, short: true });
    fields.push({ label: 'Occurred At', value: occurredAtFormatted, short: false });
    if (tracePublicId || traceId) fields.push({ label: 'Trace ID', value: tracePublicId || traceId || '', short: false });
    if (spanPublicId || spanId) fields.push({ label: 'Span ID', value: spanPublicId || spanId || '', short: true });
    if (clientIp) fields.push({ label: 'Client IP', value: clientIp, short: true });
    if (errorMessage) fields.push({ label: 'Error Message', value: errorMessage, short: false });

    // AI Insight
    const rawAiInsight = (candidate as any).aiInsight
      || (evidence as any).aiInsight
      || (payload as any).aiInsight
      || (metadata as any).aiInsight;
    const aiInsight = rawAiInsight && typeof rawAiInsight.text === 'string'
      ? { text: rawAiInsight.text, confidence: typeof rawAiInsight.confidence === 'number' ? rawAiInsight.confidence : undefined }
      : undefined;

    formatterLogger.debug({ durationMs: Date.now() - startedTime }, 'alert_context_extraction_success');

    return {
      ruleName,
      ruleId,
      severity,
      category,
      alertKey,
      alertEventId,
      kind,
      isLatency,
      isError,
      isErrorRate,
      observedValue,
      thresholdValue,
      observedFormatted,
      thresholdFormatted,
      differenceMs,
      differencePercent,
      differenceFormatted,
      aboveThresholdFormatted,
      evaluationWindow,
      endpoint,
      method,
      statusCode,
      durationMs,
      timeTakenFormatted,
      occurredAt,
      occurredAtFormatted,
      traceId,
      tracePublicId,
      spanId,
      spanPublicId,
      requestId,
      eventPublicId,
      eventId,
      clientIp,
      userAgent,
      errorMessage,
      errorType,
      fingerprint,
      handled,
      mechanism,
      sourceFrame,
      sourceFunction,
      sourceContext,
      occurrences,
      firstSeenAt,
      lastSeenAt,
      release,
      framework,
      stackSnippet,
      projectId,
      projectSlug,
      projectName,
      environment,
      service,
      organizationId,
      orgSlug,
      orgName,
      source,
      summary,
      subject,
      fields,
      alertUrl,
      traceUrl,
      requestUrl,
      errorUrl,
      eventUrl,
      acknowledgeUrl,
      silenceUrl,
      preferencesUrl,
      escalationStep,
      policyName: (policy.name as string | undefined) || (payload.policyName as string | undefined),
      aiInsight,
      rawEvidence: evidence,
      rawPolicy: policy,
    };
  } catch (err) {
    formatterLogger.error({ err }, 'alert_context_extraction_failure');
    throw err;
  }
}

/**
 * Build rich, structured NotificationPayload for alerting jobs conforming to Section 11.
 */
export function buildAlertNotificationPayload(
  candidate: AlertDecisionCandidate,
  routingDecisionHash?: string,
): NotificationPayload & Record<string, unknown> {
  const ctx = extractAlertContext({ candidate });

  let diagnostic: LatencyDiagnostic | ErrorDiagnostic | Record<string, unknown>;
  if (ctx.isLatency) {
    diagnostic = {
      kind: 'latency',
      percentile: ctx.ruleName.toLowerCase().includes('p99') ? 'p99' : ctx.ruleName.toLowerCase().includes('p90') ? 'p90' : 'p95',
      observedValue: ctx.observedValue ?? 0,
      observedFormatted: ctx.observedFormatted ?? 'n/a',
      thresholdValue: ctx.thresholdValue ?? 0,
      thresholdFormatted: ctx.thresholdFormatted ?? 'n/a',
      unit: 'ms',
      differenceMs: ctx.differenceMs,
      differenceFormatted: ctx.differenceFormatted,
      differencePercent: ctx.differencePercent,
      aboveThresholdFormatted: ctx.aboveThresholdFormatted,
      evaluationWindow: ctx.evaluationWindow,
      method: ctx.method,
      route: ctx.endpoint,
      statusCode: ctx.statusCode,
      durationMs: ctx.durationMs,
      aiInsight: ctx.aiInsight,
    };
  } else if (ctx.isError) {
    diagnostic = {
      kind: 'error',
      exceptionType: ctx.errorType,
      message: ctx.errorMessage || 'Error occurred',
      fingerprint: ctx.fingerprint,
      handled: ctx.handled,
      mechanism: ctx.mechanism,
      method: ctx.method,
      route: ctx.endpoint,
      statusCode: ctx.statusCode,
      durationMs: ctx.durationMs,
      primaryFrame: ctx.sourceFrame ? { file: ctx.sourceFrame, function: ctx.sourceFunction } : undefined,
      sourceContext: ctx.sourceContext,
      occurrences: ctx.occurrences,
      firstSeenAt: ctx.firstSeenAt,
      lastSeenAt: ctx.lastSeenAt,
      framework: ctx.framework,
      aiInsight: ctx.aiInsight,
    };
  } else {
    diagnostic = {
      observedValue: ctx.observedValue,
      thresholdValue: ctx.thresholdValue,
      observedFormatted: ctx.observedFormatted,
      thresholdFormatted: ctx.thresholdFormatted,
    };
  }

  const payload: NotificationPayload & Record<string, unknown> = {
    notificationType: ctx.kind === 'recovered' ? 'alert.recovered' : 'alert',
    severity: ctx.severity,
    title: ctx.ruleName,
    body: ctx.summary,
    fields: ctx.fields,
    correlationId: ctx.alertKey,
    dedupKey: `${ctx.alertKey}:${ctx.kind}`,
    metadata: {
      alertKey: ctx.alertKey,
      alertEventId: ctx.alertEventId,
      ruleId: ctx.ruleId,
      ruleName: ctx.ruleName,
      category: ctx.category,
      endpoint: ctx.endpoint,
      method: ctx.method,
      statusCode: ctx.statusCode,
      observedValue: ctx.observedValue,
      thresholdValue: ctx.thresholdValue,
      observedFormatted: ctx.observedFormatted,
      thresholdFormatted: ctx.thresholdFormatted,
      aboveThresholdFormatted: ctx.aboveThresholdFormatted,
      durationMs: ctx.durationMs,
      timeTakenFormatted: ctx.timeTakenFormatted,
      traceId: ctx.traceId,
      tracePublicId: ctx.tracePublicId,
      spanId: ctx.spanId,
      spanPublicId: ctx.spanPublicId,
      requestId: ctx.requestId,
      eventPublicId: ctx.eventPublicId,
      eventId: ctx.eventId,
      clientIp: ctx.clientIp,
      userAgent: ctx.userAgent,
      errorMessage: ctx.errorMessage,
      errorType: ctx.errorType,
      fingerprint: ctx.fingerprint,
      sourceFrame: ctx.sourceFrame,
      sourceFunction: ctx.sourceFunction,
      sourceContext: ctx.sourceContext,
      occurredAt: ctx.occurredAt.toISOString(),
      occurredAtFormatted: ctx.occurredAtFormatted,
      projectId: ctx.projectId,
      projectSlug: ctx.projectSlug,
      projectName: ctx.projectName,
      environment: ctx.environment,
      service: ctx.service,
      organizationId: ctx.organizationId,
      orgSlug: ctx.orgSlug,
      orgName: ctx.orgName,
      subject: ctx.subject,
      summary: ctx.summary,
      traceUrl: ctx.traceUrl,
      requestUrl: ctx.requestUrl,
      errorUrl: ctx.errorUrl,
      eventUrl: ctx.eventUrl,
      acknowledgeUrl: ctx.acknowledgeUrl,
      silenceUrl: ctx.silenceUrl,
      preferencesUrl: ctx.preferencesUrl,
      policy: candidate.policy,
      evidence: candidate.evidence ?? {},
      annotations: candidate.annotations ?? {},
      routingDecisionHash: routingDecisionHash ?? null,
      diagnostic,
    },
    // Top-level contract fields (Section 11)
    type: ctx.kind === 'recovered' ? 'alert.resolved' : ctx.escalationStep ? 'alert.escalated' : 'alert.firing',
    alert: {
      id: ctx.alertEventId || ctx.alertKey,
      publicId: ctx.alertEventId,
      ruleId: ctx.ruleId,
      ruleName: ctx.ruleName,
      severity: ctx.severity,
      status: ctx.kind === 'recovered' ? 'resolved' : 'firing',
      startedAt: ctx.occurredAt.toISOString(),
    },
    project: {
      organizationId: ctx.organizationId,
      organizationSlug: ctx.orgSlug || '',
      organizationName: ctx.orgName || '',
      projectId: ctx.projectId || '',
      projectSlug: ctx.projectSlug || '',
      projectName: ctx.projectName || '',
      environment: ctx.environment || 'production',
      serviceName: ctx.service || undefined,
      release: ctx.release || undefined,
    },
    event: {
      type: (candidate.evidence?.eventType as string) || (ctx.isLatency ? 'request' : 'error'),
      publicId: ctx.eventPublicId,
      eventId: ctx.eventId,
      occurredAt: ctx.occurredAt.toISOString(),
    },
    correlation: {
      requestId: ctx.requestId,
      traceId: ctx.traceId,
      tracePublicId: ctx.tracePublicId,
      spanId: ctx.spanId,
      spanPublicId: ctx.spanPublicId,
    },
    diagnostic,
    actions: {
      viewAlert: ctx.alertUrl || '',
      viewEvent: ctx.eventUrl,
      viewRequest: ctx.requestUrl,
      viewError: ctx.errorUrl,
      viewTrace: ctx.traceUrl,
      acknowledge: ctx.acknowledgeUrl,
      silence: ctx.silenceUrl,
      preferences: ctx.preferencesUrl,
    },
    // Backwards-compatible aliases
    subject: ctx.subject,
    summary: ctx.summary,
    endpoint: ctx.endpoint,
    method: ctx.method,
    statusCode: ctx.statusCode,
    traceId: ctx.traceId,
    observedValue: ctx.observedValue,
    thresholdValue: ctx.thresholdValue,
    observedFormatted: ctx.observedFormatted,
    thresholdFormatted: ctx.thresholdFormatted,
    durationMs: ctx.durationMs,
    timeTakenFormatted: ctx.timeTakenFormatted,
    occurredAt: ctx.occurredAt.toISOString(),
    occurredAtFormatted: ctx.occurredAtFormatted,
    policy: candidate.policy,
    evidence: candidate.evidence ?? {},
    annotations: candidate.annotations ?? {},
    routingDecisionHash: routingDecisionHash ?? null,
  };

  if (ctx.alertUrl) {
    payload.url = ctx.alertUrl;
  }

  const payloadSize = JSON.stringify(payload).length;
  formatterLogger.debug({ payloadSize }, 'notification_payload_size');

  return payload;
}

/**
 * Render Sentinel Mono enterprise email for any alert job data.
 */
export function renderEnterpriseAlertEmail(jobData: {
  payload?: Record<string, unknown> | undefined;
  organizationId?: string | undefined;
  projectId?: string | null | undefined;
  alertKey?: string | undefined;
  alertEventId?: string | undefined;
  severity?: string | undefined;
  ruleId?: string | undefined;
  deliveryMode?: string | undefined;
  recipientEmail?: string | undefined;
}): EmailTemplate {
  const startedRender = Date.now();
  const payload = jobData.payload ?? {};
  const metadata = (payload.metadata ?? {}) as Record<string, unknown>;
  const ctx = extractAlertContext({
    payload: { ...metadata, ...payload },
    alertKey: jobData.alertKey ?? undefined,
    alertEventId: jobData.alertEventId ?? undefined,
    organizationId: jobData.organizationId ?? undefined,
    projectId: jobData.projectId,
    severity: jobData.severity ?? undefined,
    ruleId: jobData.ruleId ?? undefined,
  });

  const appName = 'Pulsiv';
  const scope = {
    appName,
    orgName: ctx.orgName || ctx.orgSlug || undefined,
    projectName: ctx.projectName || ctx.projectSlug || undefined,
    environment: ctx.environment ?? undefined,
    alertUrl: ctx.alertUrl,
    acknowledgeUrl: ctx.acknowledgeUrl,
    silenceUrl: ctx.silenceUrl,
    preferencesUrl: ctx.preferencesUrl,
  };

  const extraRows: DataRow[] = [];
  if (ctx.traceUrl) {
    extraRows.push({ label: 'Trace link', value: ctx.traceUrl });
  }

  let template: EmailTemplate;

  // 1. Recovered notice
  if (ctx.kind === 'recovered') {
    template = alertResolvedTemplate({
      ...scope,
      identity: {
        ruleName: ctx.ruleName,
        severity: ctx.severity,
        endpoint: ctx.endpoint,
        method: ctx.method,
        statusCode: ctx.statusCode,
        startedAt: ctx.occurredAtFormatted,
        fingerprint: ctx.alertKey,
        eventId: ctx.alertEventId,
        source: ctx.source,
      },
      resolvedAt: formatTimestamp(new Date()),
      recoveredValue: ctx.observedFormatted,
    });
  } else if (ctx.escalationStep) {
    // 2. Escalated notice
    template = alertEscalatedTemplate({
      ...scope,
      identity: {
        ruleName: ctx.ruleName,
        severity: ctx.severity,
        endpoint: ctx.endpoint,
        method: ctx.method,
        statusCode: ctx.statusCode,
        duration: ctx.timeTakenFormatted,
        startedAt: ctx.occurredAtFormatted,
        traceId: ctx.tracePublicId || ctx.traceId,
        spanId: ctx.spanPublicId || ctx.spanId,
        clientIp: ctx.clientIp,
        fingerprint: ctx.alertKey,
        eventId: ctx.alertEventId,
        source: ctx.source,
      },
      policyName: ctx.policyName || 'Default Escalation Policy',
      stepNumber: ctx.escalationStep,
    });
  } else if (ctx.isLatency && (ctx.observedFormatted || ctx.thresholdFormatted || ctx.endpoint || ctx.timeTakenFormatted)) {
    // 3. High Latency Alert (Section 9)
    template = latencyAlertTemplate({
      ...scope,
      percentile: ctx.ruleName.toLowerCase().includes('p99') ? 'p99' : ctx.ruleName.toLowerCase().includes('p90') ? 'p90' : 'p95',
      observed: ctx.observedFormatted || ctx.timeTakenFormatted || 'Breached',
      threshold: ctx.thresholdFormatted || 'Configured limit',
      aboveThreshold: ctx.aboveThresholdFormatted,
      window: ctx.evaluationWindow,
      endpoint: ctx.endpoint,
      method: ctx.method,
      statusCode: ctx.statusCode,
      duration: ctx.timeTakenFormatted,
      traceId: ctx.traceId,
      tracePublicId: ctx.tracePublicId,
      spanId: ctx.spanId,
      spanPublicId: ctx.spanPublicId,
      requestId: ctx.requestId,
      clientIp: ctx.clientIp,
      service: ctx.service ?? undefined,
      release: ctx.release ?? undefined,
      ruleName: ctx.ruleName,
      severity: ctx.severity,
      startedAt: ctx.occurredAtFormatted,
      insight: ctx.aiInsight,
      traceUrl: ctx.traceUrl,
      requestUrl: ctx.requestUrl,
      extraRows: extraRows.length > 0 ? extraRows : undefined,
    });
  } else if (ctx.isError && (ctx.errorMessage || ctx.errorType || ctx.sourceFrame || !ctx.thresholdValue)) {
    // 4. Developer-Focused Error Alert (Section 10)
    template = errorAlertTemplate({
      ...scope,
      ruleName: ctx.ruleName,
      errorName: ctx.errorType,
      errorMessage: ctx.errorMessage,
      errorId: ctx.eventPublicId || ctx.alertEventId,
      fingerprint: ctx.fingerprint || ctx.alertKey,
      handled: ctx.handled,
      mechanism: ctx.mechanism,
      sourceFrame: ctx.sourceFrame,
      sourceFunction: ctx.sourceFunction,
      sourceContext: ctx.sourceContext,
      endpoint: ctx.endpoint,
      method: ctx.method,
      statusCode: ctx.statusCode,
      requestId: ctx.requestId,
      occurrences: ctx.occurrences,
      firstSeenAt: ctx.firstSeenAt,
      lastSeenAt: ctx.lastSeenAt,
      service: ctx.service ?? undefined,
      release: ctx.release ?? undefined,
      framework: ctx.framework,
      traceId: ctx.traceId,
      tracePublicId: ctx.tracePublicId,
      spanId: ctx.spanId,
      spanPublicId: ctx.spanPublicId,
      clientIp: ctx.clientIp,
      severity: ctx.severity,
      startedAt: ctx.occurredAtFormatted,
      insight: ctx.aiInsight,
      traceUrl: ctx.traceUrl,
      errorUrl: ctx.errorUrl,
      eventUrl: ctx.eventUrl,
      requestUrl: ctx.requestUrl,
      extraRows: extraRows.length > 0 ? extraRows : undefined,
    });
  } else if (ctx.isErrorRate && ctx.observedFormatted && ctx.thresholdFormatted) {
    // 5. Error Rate Spike
    template = errorSpikeTemplate({
      ...scope,
      errorRate: ctx.observedFormatted,
      threshold: ctx.thresholdFormatted,
      endpoint: ctx.endpoint,
      method: ctx.method,
      topStatusCode: ctx.statusCode ? String(ctx.statusCode) : undefined,
      topError: ctx.errorMessage,
      traceId: ctx.tracePublicId || ctx.traceId,
      spanId: ctx.spanPublicId || ctx.spanId,
      clientIp: ctx.clientIp,
      service: ctx.service ?? undefined,
      severity: ctx.severity,
      startedAt: ctx.occurredAtFormatted,
      extraRows: extraRows.length > 0 ? extraRows : undefined,
    });
  } else {
    // 6. Standard Alert Firing
    template = alertFiringTemplate({
      ...scope,
      identity: {
        ruleName: ctx.ruleName,
        severity: ctx.severity,
        endpoint: ctx.endpoint,
        method: ctx.method,
        statusCode: ctx.statusCode,
        duration: ctx.timeTakenFormatted,
        service: ctx.service ?? undefined,
        startedAt: ctx.occurredAtFormatted,
        traceId: ctx.tracePublicId || ctx.traceId,
        spanId: ctx.spanPublicId || ctx.spanId,
        clientIp: ctx.clientIp,
        fingerprint: ctx.alertKey,
        eventId: ctx.alertEventId,
        source: ctx.source,
        extraRows: extraRows.length > 0 ? extraRows : undefined,
      },
      measurement: ctx.observedFormatted && ctx.thresholdFormatted
        ? {
            label: ctx.category === 'performance' ? 'Observed latency' : 'Observed metric',
            value: ctx.observedFormatted,
            threshold: ctx.thresholdFormatted,
          }
        : undefined,
      summary: ctx.summary,
    });
  }

  formatterLogger.debug({ durationMs: Date.now() - startedRender }, 'email_render_duration');

  return {
    ...template,
    subject: ctx.subject,
  };
}


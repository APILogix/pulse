import { type AlertSeverity, type EmailTemplate } from '../../../shared/email/index.js';
import type { AlertDecisionCandidate } from '../decision/decision.engine.js';
import type { NotificationPayload } from '../../connectors/types.js';
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
    fields: Array<{
        label: string;
        value: string;
        short?: boolean | undefined;
    }>;
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
    aiInsight?: {
        text: string;
        confidence?: number;
    } | undefined;
    rawEvidence: Record<string, unknown>;
    rawPolicy?: Record<string, unknown> | undefined;
}
/** Format milliseconds or numbers cleanly. */
export declare function formatDuration(ms: number | null | undefined): string;
/** Format numbers with units or percentages based on field/category. */
export declare function formatMetricValue(value: number | null | undefined, fieldHint?: string): string;
/** Format timestamp in UTC and human-readable format. */
export declare function formatTimestamp(date: Date | string | number | undefined): string;
/** Get public base URL for links. */
export declare function getAppBaseUrl(): string;
/** Normalize local / server file paths into application-relative paths. */
export declare function normalizeFilePath(filepath: unknown): string;
export interface ExtractedSourceFrame {
    location: string;
    functionName?: string | undefined;
    sourceContext?: string | undefined;
}
/** Select the most relevant in-app stack frame and excerpt. */
export declare function extractPrimarySourceFrame(stackRaw: unknown, framesRaw: unknown): ExtractedSourceFrame | undefined;
/** Extract all diagnostic fields from candidate, evidence, event, payload. */
export declare function extractAlertContext(input: {
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
}): ExtractedAlertContext;
/**
 * Build rich, structured NotificationPayload for alerting jobs conforming to Section 11.
 */
export declare function buildAlertNotificationPayload(candidate: AlertDecisionCandidate, routingDecisionHash?: string): NotificationPayload & Record<string, unknown>;
/**
 * Render Sentinel Mono enterprise email for any alert job data.
 */
export declare function renderEnterpriseAlertEmail(jobData: {
    payload?: Record<string, unknown> | undefined;
    organizationId?: string | undefined;
    projectId?: string | null | undefined;
    alertKey?: string | undefined;
    alertEventId?: string | undefined;
    severity?: string | undefined;
    ruleId?: string | undefined;
    deliveryMode?: string | undefined;
    recipientEmail?: string | undefined;
}): EmailTemplate;
//# sourceMappingURL=alert-notification-formatter.d.ts.map
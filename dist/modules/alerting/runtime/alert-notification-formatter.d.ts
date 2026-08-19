import { type AlertSeverity, type EmailTemplate } from '../../../shared/email/index.js';
import type { AlertDecisionCandidate } from '../decision/decision.engine.js';
import type { NotificationPayload } from '../../connectors/types.js';
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
    observedValue?: number | null | undefined;
    thresholdValue?: number | null | undefined;
    observedFormatted?: string | undefined;
    thresholdFormatted?: string | undefined;
    endpoint?: string | undefined;
    method?: string | undefined;
    statusCode?: number | string | undefined;
    durationMs?: number | undefined;
    timeTakenFormatted?: string | undefined;
    occurredAt: Date;
    occurredAtFormatted: string;
    traceId?: string | undefined;
    spanId?: string | undefined;
    clientIp?: string | undefined;
    userAgent?: string | undefined;
    errorMessage?: string | undefined;
    errorType?: string | undefined;
    stackSnippet?: string | undefined;
    projectId?: string | null | undefined;
    projectName?: string | null | undefined;
    environment?: string | null | undefined;
    service?: string | null | undefined;
    organizationId: string;
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
    acknowledgeUrl?: string | undefined;
    silenceUrl?: string | undefined;
    preferencesUrl?: string | undefined;
    escalationStep?: number | undefined;
    policyName?: string | undefined;
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
/** Extract all diagnostic fields from raw objects (candidate, evidence, event, payload). */
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
 * Build rich, structured NotificationPayload for alerting jobs.
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
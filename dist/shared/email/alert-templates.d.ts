/**
 * Alert & monitoring email templates — Sentinel Mono.
 *
 * These are the on-call surface of the product. They obey a different set of
 * rules from the transactional templates in `./templates.ts`, because the
 * reader is triaging at 03:00, not browsing:
 *
 *   1. **No greeting.** An alert is machine-to-human. It leads with the fact,
 *      not with "Hi,". Every word before the verdict is a word in the way.
 *   2. **Subject is the alert.** A bracketed state tag comes first, so inbox
 *      rules, pager bridges and mobile previews can classify the message from
 *      its first few characters.
 *   3. **Severity is pre-verbal.** The state line under the header strip is a
 *      tinted band with a drawn status dot, so the verdict registers before a
 *      word is parsed — and survives a plaintext-only client via the subject.
 *   4. **Numbers before prose.** The readout band sets the observed value
 *      against its threshold in mono, and the meter beneath draws the
 *      crossing: the stretch past the threshold is the only saturated colour
 *      in the band.
 *   5. **Action before evidence.** One white button, a ghost secondary and
 *      quiet text links sit above the fact sections, so a reader who has
 *      already decided never scrolls past tables to act.
 *   6. **Cyan means a model said it.** AI insight cards are the only cyan in
 *      the email. If cyan appears, inference produced that sentence, and it
 *      arrives with a confidence score attached.
 *   7. **Every alert is identifiable.** Fingerprint and event id ship in the
 *      body so an email can be correlated with the audit log and the dedupe
 *      chain without opening the app.
 *
 * Every rule-based notice shares one anatomy: the state line names the event
 * (firing, resolved, escalated), the headline names the rule, and the facts
 * below are grouped the way the console's detail sheet groups them.
 */
import { type DataRow } from './components.js';
import { type AlertSeverity } from './theme.js';
import type { EmailTemplate } from './templates.js';
export type { AlertSeverity };
/** Tenant/scope context shared by every alert email. */
export interface AlertScope {
    appName: string;
    orgName?: string | undefined;
    projectName?: string | undefined;
    /** Environment slug — production, staging, … */
    environment?: string | undefined;
    /** Deep link to the alert event in the app. */
    alertUrl?: string | undefined;
    /** Acknowledge action link. */
    acknowledgeUrl?: string | undefined;
    /** Silence action link. */
    silenceUrl?: string | undefined;
    /** Notification preferences, rendered as the footer link. */
    preferencesUrl?: string | undefined;
}
/** Identity of the firing rule and its event. */
export interface AlertIdentity {
    /** Rule name as configured, e.g. "API p95 latency". */
    ruleName: string;
    severity: AlertSeverity;
    /** Where the signal came from, e.g. "telemetry", "synthetic", "logs". */
    source?: string | undefined;
    /** Dedupe fingerprint — the key that groups repeats of this same alert. */
    fingerprint?: string | undefined;
    /** Alert event id, for correlation with the audit log. */
    eventId?: string | undefined;
    /** Pre-formatted timestamp — formatting/timezone is the caller's job. */
    startedAt?: string | undefined;
    /** How many times this fingerprint has fired in the current window. */
    occurrences?: number | undefined;
    /** Route / endpoint, e.g. "/api/v1/checkout". */
    endpoint?: string | undefined;
    /** HTTP method, e.g. "POST". */
    method?: string | undefined;
    /** HTTP status code, e.g. 500. */
    statusCode?: string | number | undefined;
    /** Latency / time taken, e.g. "1,450 ms". */
    duration?: string | undefined;
    /** Service name, e.g. "api". */
    service?: string | undefined;
    /** Distributed trace ID for root cause analysis. */
    traceId?: string | undefined;
    /** Distributed span ID. */
    spanId?: string | undefined;
    /** Client IP address. */
    clientIp?: string | undefined;
    /** Optional extra data table rows. */
    extraRows?: DataRow[] | undefined;
}
/** Observed value against the threshold that was crossed. */
export interface AlertMeasurement {
    /** What is being measured, e.g. "p95 latency", "Error rate". */
    label: string;
    /** Observed value, pre-formatted with units, e.g. "1,842 ms". */
    value: string;
    /** Threshold, pre-formatted with units, e.g. "800 ms". */
    threshold: string;
    /** Comparison window, e.g. "last 5 minutes". */
    window?: string | undefined;
}
/** Optional model output attached to an alert. */
export interface AlertInsight {
    text: string;
    /** 0–100. Omit when the model does not produce a score. */
    confidence?: number | undefined;
}
export interface AlertFiringInput extends AlertScope {
    identity: AlertIdentity;
    /** Optional measurement that tripped the rule. */
    measurement?: AlertMeasurement | undefined;
    /** One-line human summary of what is wrong. */
    summary?: string | undefined;
    /** Suggested first action, rendered as a neutral callout. */
    runbook?: string | undefined;
    /** Model output — the only cyan in the email. */
    insight?: AlertInsight | undefined;
    traceUrl?: string | undefined;
    requestUrl?: string | undefined;
}
/**
 * The core alert notification: a rule crossed its threshold and is firing.
 *
 * Reading order: the verdict band, the rule, the crossing (readout + meter),
 * the summary and any model insight, the decision, then the evidence grouped
 * as request, incident and correlation facts.
 */
export declare function alertFiringTemplate(input: AlertFiringInput): EmailTemplate;
export interface AlertResolvedInput extends AlertScope {
    identity: AlertIdentity;
    /** How long the alert was firing, pre-formatted, e.g. "14 minutes". */
    duration?: string | undefined;
    /** Who or what resolved it — a user name, or "auto-resolve". */
    resolvedBy?: string | undefined;
    /** Pre-formatted resolution timestamp. */
    resolvedAt?: string | undefined;
    /** Resolution reason recorded on the event. */
    reason?: string | undefined;
    /** Value the metric recovered to, e.g. "412 ms". */
    recoveredValue?: string | undefined;
    insight?: AlertInsight | undefined;
}
/**
 * Recovery notice. Always sent when a firing alert clears.
 * Green here is the truth channel doing its job: a verdict, not decoration.
 */
export declare function alertResolvedTemplate(input: AlertResolvedInput): EmailTemplate;
export interface AlertAcknowledgedInput extends AlertScope {
    identity: AlertIdentity;
    /** Who took it. */
    acknowledgedBy: string;
    acknowledgedAt?: string | undefined;
    /** Note left by the responder. */
    comment?: string | undefined;
    /** When the acknowledgement lapses and escalation resumes. */
    expiresAt?: string | undefined;
}
/**
 * Acknowledgement notice — tells the rest of the rotation the alert is owned.
 */
export declare function alertAcknowledgedTemplate(input: AlertAcknowledgedInput): EmailTemplate;
export interface AlertEscalatedInput extends AlertScope {
    identity: AlertIdentity;
    /** Escalation policy name. */
    policyName: string;
    /** Which step just fired (1-based). */
    stepNumber: number;
    totalSteps?: number | undefined;
    /** Why it escalated, e.g. "no acknowledgement within 15 minutes". */
    trigger?: string | undefined;
    /** Who this step notifies. */
    notifying?: string | undefined;
    /** How long it has been firing. */
    firingFor?: string | undefined;
}
/**
 * Escalation notice — an alert went unanswered and the policy advanced.
 *
 * The readout shows how far the policy has advanced, and the step track draws
 * it: taken steps fill red, the steps still to come wait on the track.
 */
export declare function alertEscalatedTemplate(input: AlertEscalatedInput): EmailTemplate;
export interface AlertSilencedInput extends AlertScope {
    /** What the silence matches — rule name, or a label matcher expression. */
    target: string;
    silencedBy: string;
    /** Pre-formatted expiry, or "never" for an open-ended silence. */
    expiresAt: string;
    /** Duration, pre-formatted. */
    duration?: string | undefined;
    reason?: string | undefined;
    /** How many rules the matcher covers. */
    matchedRules?: number | undefined;
}
/**
 * Silence-created notice. The readout states the size of the coverage gap:
 * how long, and how many rules it swallows.
 */
export declare function alertSilencedTemplate(input: AlertSilencedInput): EmailTemplate;
export interface DigestAlertEntry {
    ruleName: string;
    severity: AlertSeverity;
    /** Short context line, e.g. "checkout-api · 12 occurrences · 09:41". */
    meta: string;
}
export interface AlertDigestInput extends AlertScope {
    /** Period covered, e.g. "last 24 hours". */
    period: string;
    counts: {
        firing: number;
        resolved: number;
        acknowledged: number;
    };
    /** Alerts to list, already sorted by the caller (severity, then recency). */
    entries: DigestAlertEntry[];
    /** Total matching alerts when `entries` is truncated. */
    totalCount?: number | undefined;
    /** Link to the full alert feed. */
    feedUrl?: string | undefined;
    insight?: AlertInsight | undefined;
}
/**
 * Periodic roll-up.
 *
 * The antidote to per-event noise: batch low-severity alerts into one scannable
 * digest so the real-time channel stays trustworthy for things that actually
 * need waking someone up. Counts read as a readout band; a zero stays muted,
 * because colour on a zero is decoration, not a verdict.
 */
export declare function alertDigestTemplate(input: AlertDigestInput): EmailTemplate;
export interface AnomalyDetectedInput extends AlertScope {
    /** What looks wrong, e.g. "Request latency deviating from baseline". */
    title: string;
    /** The model's explanation. */
    explanation: string;
    /** 0–100 confidence. */
    confidence?: number | undefined;
    /** Metric under observation. */
    metric?: string | undefined;
    /** Observed value, pre-formatted. */
    observed?: string | undefined;
    /** Learned baseline, pre-formatted. */
    baseline?: string | undefined;
    /** Deviation, pre-formatted, e.g. "+340%". */
    deviation?: string | undefined;
    /** Window the model looked at. */
    window?: string | undefined;
    detectedAt?: string | undefined;
    /** Model-suggested remediation. */
    suggestedAction?: string | undefined;
}
/**
 * AI anomaly notice.
 *
 * The one template where cyan is the dominant channel, because the entire
 * message is model output — there is no threshold, only inference. Baseline and
 * deviation sit beside the observed value, and the meter draws the distance
 * from the baseline, so the reader can judge the claim instead of taking it on
 * trust.
 */
export declare function anomalyDetectedTemplate(input: AnomalyDetectedInput): EmailTemplate;
export interface LatencyAlertInput extends AlertScope {
    /** Percentile being watched, e.g. "p95" or "P95". */
    percentile: string;
    /** Observed latency, pre-formatted with units, e.g. "1,450 ms" or "1.45s". */
    observed: string;
    /** Configured threshold, pre-formatted with units, e.g. "500 ms". */
    threshold: string;
    /** Difference above threshold, e.g. "+950 ms (+190%)". */
    aboveThreshold?: string | undefined;
    /** Evaluation window, e.g. "5 min". */
    window?: string | undefined;
    /** Route or service that is slow, e.g. "/api/v1/orders". */
    endpoint?: string | undefined;
    /** HTTP method, e.g. "POST". */
    method?: string | undefined;
    /** HTTP status code, e.g. 504. */
    statusCode?: string | number | undefined;
    /** Duration taken, e.g. "1,450 ms" or "1.45s". */
    duration?: string | undefined;
    /** Distributed trace ID. */
    traceId?: string | undefined;
    /** Public trace ID, e.g. "TRC-000000052". */
    tracePublicId?: string | undefined;
    /** Distributed span ID. */
    spanId?: string | undefined;
    /** Public span ID, e.g. "SPN-000001293". */
    spanPublicId?: string | undefined;
    /** Request ID, e.g. "REQ-000000123". */
    requestId?: string | undefined;
    /** Client IP address. */
    clientIp?: string | undefined;
    /** Service name, e.g. "checkout-api". */
    service?: string | undefined;
    /** Release, e.g. "1.0.0". */
    release?: string | undefined;
    /** Rule name as configured. */
    ruleName?: string | undefined;
    /** Sample size behind the percentile. */
    sampleSize?: number | undefined;
    /** Slowest contributing operations. */
    topContributors?: string[] | undefined;
    severity?: AlertSeverity | undefined;
    startedAt?: string | undefined;
    insight?: AlertInsight | undefined;
    extraRows?: DataRow[] | undefined;
    traceUrl?: string | undefined;
    requestUrl?: string | undefined;
}
/**
 * Latency threshold breach — developer-focused performance triage.
 */
export declare function latencyAlertTemplate(input: LatencyAlertInput): EmailTemplate;
export interface ErrorAlertInput extends AlertScope {
    ruleName: string;
    errorName?: string | undefined;
    errorMessage?: string | undefined;
    errorId?: string | undefined;
    fingerprint?: string | undefined;
    handled?: boolean | string | undefined;
    mechanism?: string | undefined;
    sourceFrame?: string | undefined;
    sourceFunction?: string | undefined;
    sourceContext?: string | undefined;
    endpoint?: string | undefined;
    method?: string | undefined;
    statusCode?: string | number | undefined;
    requestId?: string | undefined;
    occurrences?: number | undefined;
    firstSeenAt?: string | undefined;
    lastSeenAt?: string | undefined;
    service?: string | undefined;
    release?: string | undefined;
    framework?: string | undefined;
    traceId?: string | undefined;
    tracePublicId?: string | undefined;
    spanId?: string | undefined;
    spanPublicId?: string | undefined;
    clientIp?: string | undefined;
    severity?: AlertSeverity | undefined;
    startedAt?: string | undefined;
    insight?: AlertInsight | undefined;
    extraRows?: DataRow[] | undefined;
    traceUrl?: string | undefined;
    errorUrl?: string | undefined;
    eventUrl?: string | undefined;
    requestUrl?: string | undefined;
}
/**
 * Developer-focused error alert.
 *
 * The readout band reads like the top of a stack trace — the exception type in
 * the verdict colour, the message, and the `at fn (file:line:col)` frame — so
 * the reader knows what broke and where before any table.
 */
export declare function errorAlertTemplate(input: ErrorAlertInput): EmailTemplate;
export interface ErrorSpikeInput extends AlertScope {
    /** Observed error rate, pre-formatted, e.g. "12.4%". */
    errorRate: string;
    /** Threshold, pre-formatted, e.g. "2%". */
    threshold: string;
    /** Absolute failing request count. */
    errorCount?: number | undefined;
    /** Total requests in the window. */
    totalRequests?: number | undefined;
    window?: string | undefined;
    /** Dominant status code, e.g. "503". */
    topStatusCode?: string | undefined;
    /** Most frequent error message or exception type. */
    topError?: string | undefined;
    endpoint?: string | undefined;
    /** HTTP method, e.g. "POST". */
    method?: string | undefined;
    /** Distributed trace ID. */
    traceId?: string | undefined;
    /** Distributed span ID. */
    spanId?: string | undefined;
    /** Client IP address. */
    clientIp?: string | undefined;
    /** Service name. */
    service?: string | undefined;
    severity?: AlertSeverity | undefined;
    startedAt?: string | undefined;
    insight?: AlertInsight | undefined;
    extraRows?: DataRow[] | undefined;
    traceUrl?: string | undefined;
    requestUrl?: string | undefined;
}
/**
 * Error-rate spike. The rate carries the readout; the absolute count leads the
 * impact facts, because a rate alone hides whether this is 50% of 2 requests
 * or of 2 million.
 */
export declare function errorSpikeTemplate(input: ErrorSpikeInput): EmailTemplate;
export type ServiceHealthStatus = 'down' | 'degraded' | 'recovered';
export interface ServiceHealthInput extends AlertScope {
    serviceName: string;
    status: ServiceHealthStatus;
    /** What the check observed, e.g. "connection refused", "HTTP 503". */
    detail?: string | undefined;
    /** Endpoint or check that reported it. */
    checkUrl?: string | undefined;
    /** Region or probe location. */
    region?: string | undefined;
    /** Consecutive failed checks before firing. */
    failedChecks?: number | undefined;
    /** Downtime duration for `recovered`, pre-formatted. */
    downtime?: string | undefined;
    /** Rolling availability, pre-formatted, e.g. "99.94%". */
    availability?: string | undefined;
    observedAt?: string | undefined;
    insight?: AlertInsight | undefined;
}
/**
 * Availability transition — a service went down, degraded, or came back.
 */
export declare function serviceHealthTemplate(input: ServiceHealthInput): EmailTemplate;
export interface QuotaAlertInput extends AlertScope {
    /** What is being consumed, e.g. "Events ingested", "Log volume". */
    resource: string;
    /** Consumed amount, pre-formatted, e.g. "8.6M". */
    used: string;
    /** Plan limit, pre-formatted, e.g. "10M". */
    limit: string;
    /** Percentage consumed, 0–100+. */
    percentUsed: number;
    /** When the quota window resets, pre-formatted. */
    resetsAt?: string | undefined;
    /** Plan name. */
    planName?: string | undefined;
    /** What happens at 100% — throttling, overage billing, hard stop. */
    overagePolicy?: string | undefined;
    upgradeUrl?: string | undefined;
    usageUrl?: string | undefined;
}
/**
 * Usage-quota warning. The meter shows consumption against the plan limit:
 * under the limit the fill carries the tone, past it only the overage does.
 */
export declare function quotaAlertTemplate(input: QuotaAlertInput): EmailTemplate;
export interface DeliveryFailureInput extends AlertScope {
    /** Connector that failed, e.g. "Slack #ops", "PagerDuty primary". */
    connectorName: string;
    connectorType?: string | undefined;
    /** How many notifications failed. */
    failedCount: number;
    /** Last error returned by the connector. */
    lastError?: string | undefined;
    /** HTTP status from the last attempt. */
    statusCode?: number | undefined;
    /** Attempts already made. */
    attempts?: number | undefined;
    /** Whether the payload landed in the dead-letter queue. */
    deadLettered?: boolean | undefined;
    firstFailedAt?: string | undefined;
    lastFailedAt?: string | undefined;
    /** Link to connector settings. */
    connectorUrl?: string | undefined;
}
/**
 * Meta-alert: the alerting system itself could not deliver. The connector's
 * own response is shown verbatim in a code well, because it is usually the
 * whole diagnosis ("invalid_auth", "channel_not_found").
 */
export declare function deliveryFailureTemplate(input: DeliveryFailureInput): EmailTemplate;
export interface RuleChangedInput extends AlertScope {
    ruleName: string;
    action: 'created' | 'updated' | 'disabled' | 'deleted';
    changedBy: string;
    changedAt?: string | undefined;
    /** Field-level summary, e.g. ["Threshold 800ms → 1500ms"]. */
    changes?: string[] | undefined;
    ruleUrl?: string | undefined;
}
/**
 * Alert-rule audit notice. Field-level changes are listed one per hairline row
 * in mono, so `Threshold: 800 ms → 1500 ms` reads like a diff.
 */
export declare function ruleChangedTemplate(input: RuleChangedInput): EmailTemplate;
//# sourceMappingURL=alert-templates.d.ts.map
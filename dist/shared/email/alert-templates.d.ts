/**
 * Alert & monitoring email templates — Sentinel Mono.
 *
 * These are the on-call surface of the product. They obey a different set of
 * rules from the transactional templates in `./templates.ts`, because the
 * reader is triaging at 03:00, not browsing:
 *
 *   1. **No greeting.** An alert is machine-to-human. It leads with the fact,
 *      not with "Hi,". Every word before the verdict is a word in the way.
 *   2. **Subject is the alert.** `[FIRING · CRITICAL] rule — project (env)`
 *      follows the convention on-call engineers already have inbox rules and
 *      pager integrations for. State first, severity second, identity third.
 *   3. **Severity is pre-verbal.** The 3px top rail and the eyebrow dot carry
 *      the verdict in the truth channel, so severity registers before a single
 *      word is parsed — and survives in a plaintext-only client via the
 *      subject prefix.
 *   4. **Numbers before prose.** Observed value against threshold, in mono at
 *      30px, above any sentence explaining it.
 *   5. **Two paths, always.** "View alert" plus a mitigation
 *      ("Acknowledge", "Silence") — the reader is deciding, not reading.
 *   6. **Cyan means a model said it.** AI insight cards are the only cyan in
 *      the email (§2.4). If cyan appears, inference produced that sentence, and
 *      it arrives with a confidence score attached.
 *   7. **Every alert is identifiable.** Fingerprint and event id ship in the
 *      body so an email can be correlated with the audit log and the dedupe
 *      chain without opening the app.
 */
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
}
/**
 * The core alert notification: a rule crossed its threshold and is firing.
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
 * Recovery notice. Always sent when a firing alert clears — an unresolved
 * "firing" email with no counterpart teaches recipients to distrust the channel.
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
 * Acknowledgement notice — tells the rest of the rotation the alert is owned,
 * which is the single most effective way to stop three people debugging the
 * same incident in parallel.
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
 * Always rendered in the danger tone regardless of the rule's own severity:
 * escalation means the process failed, and that is a more urgent fact than the
 * original threshold.
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
 * Silence-created notice.
 *
 * Suppression is the most dangerous action in an alerting system, so it is
 * announced rather than performed quietly: a forgotten silence is how an outage
 * goes unnoticed for a weekend.
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
 * need waking someone up.
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
 * deviation are shown beside the observed value so the reader can judge the
 * claim instead of taking it on trust.
 */
export declare function anomalyDetectedTemplate(input: AnomalyDetectedInput): EmailTemplate;
export interface LatencyAlertInput extends AlertScope {
    /** Percentile being watched, e.g. "p95". */
    percentile: string;
    /** Observed latency, pre-formatted with units. */
    observed: string;
    /** Configured threshold, pre-formatted with units. */
    threshold: string;
    /** Evaluation window. */
    window?: string | undefined;
    /** Route or service that is slow. */
    endpoint?: string | undefined;
    /** Sample size behind the percentile — a p95 over 4 requests is noise. */
    sampleSize?: number | undefined;
    /** Slowest contributing operations. */
    topContributors?: string[] | undefined;
    severity?: AlertSeverity | undefined;
    startedAt?: string | undefined;
    insight?: AlertInsight | undefined;
}
/**
 * Latency threshold breach.
 *
 * Matches the `latency_alert` email type already used by the organization email
 * outbox. Sample size is surfaced deliberately: a percentile without its
 * denominator invites false urgency.
 */
export declare function latencyAlertTemplate(input: LatencyAlertInput): EmailTemplate;
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
    severity?: AlertSeverity | undefined;
    startedAt?: string | undefined;
    insight?: AlertInsight | undefined;
}
/**
 * Error-rate spike.
 *
 * Rate and absolute count are both shown: 50% of two requests and 50% of two
 * million demand very different responses, and a rate alone hides which one
 * you are looking at.
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
 *
 * All three states share one template so the recovery notice is guaranteed to
 * match the outage notice it closes. Divergent "up" and "down" templates are
 * how recovery mails end up missing fields the outage mail promised.
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
 * Usage-quota warning.
 *
 * Tone follows consumption rather than a fixed severity, because the same
 * message is very different news at 80% and at 100%: over limit is red,
 * approaching is amber, informational is neutral.
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
 * Meta-alert: the alerting system itself could not deliver.
 *
 * The most important alert in the product, because it is the one that reveals
 * silent failure. A broken Slack webhook means every other alert is being
 * generated correctly and going nowhere, and nobody finds out by waiting.
 * Deliberately routed over email — the channel that is failing cannot be
 * trusted to report its own failure.
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
 * Alert-rule audit notice.
 *
 * Changing a threshold silently changes what the team will and will not be told
 * about. Disabling a rule is functionally an outage in your own observability,
 * so it is announced to the org rather than left in an audit log nobody reads.
 */
export declare function ruleChangedTemplate(input: RuleChangedInput): EmailTemplate;
//# sourceMappingURL=alert-templates.d.ts.map
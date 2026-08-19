/**
 * Enterprise Alert Notification Formatter.
 *
 * Extracts and normalizes rich diagnostic context (Route, Latency, Threshold,
 * Timestamp, Trace ID, Status Code, Client IP, Environment, Project) and
 * renders Sentinel Mono enterprise emails for alert delivery.
 */
import { env } from '../../../config/env.js';
import { latencyAlertTemplate, errorSpikeTemplate, alertFiringTemplate, alertResolvedTemplate, alertEscalatedTemplate, } from '../../../shared/email/index.js';
/** Format milliseconds or numbers cleanly. */
export function formatDuration(ms) {
    if (ms === null || ms === undefined || Number.isNaN(ms))
        return 'n/a';
    if (ms >= 1000) {
        const s = ms / 1000;
        return `${s >= 10 ? Math.round(s) : s.toFixed(2)}s`;
    }
    return `${Math.round(ms).toLocaleString('en-US')} ms`;
}
/** Format numbers with units or percentages based on field/category. */
export function formatMetricValue(value, fieldHint = '') {
    if (value === null || value === undefined || Number.isNaN(value))
        return 'n/a';
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
export function formatTimestamp(date) {
    if (!date)
        return new Date().toUTCString();
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime()))
        return new Date().toUTCString();
    return d.toUTCString().replace('GMT', 'UTC');
}
/** Get public base URL for links. */
export function getAppBaseUrl() {
    const base = env.FRONTEND_URL || env.APP_URL || 'http://localhost:5173';
    return base.replace(/\/+$/, '');
}
/** Extract all diagnostic fields from raw objects (candidate, evidence, event, payload). */
export function extractAlertContext(input) {
    const candidate = input.candidate ?? {};
    const payload = input.payload ?? {};
    const evidence = (candidate.evidence ?? payload.evidence ?? {});
    const values = (evidence.values ?? payload.values ?? {});
    const labels = (evidence.labels ?? candidate.labels ?? payload.labels ?? {});
    const event = (evidence.event ?? {});
    const record = (event.record ?? event.data ?? event);
    const policy = (candidate.policy ?? payload.policy ?? {});
    const annotations = (candidate.annotations ?? payload.annotations ?? {});
    const organizationId = String(candidate.organizationId || payload.organizationId || input.organizationId || '');
    const projectId = candidate.projectId ?? payload.projectId ?? input.projectId ?? null;
    const environment = candidate.environment ?? payload.environment ?? labels.environment ?? record.environment ?? input.environment ?? null;
    const service = candidate.service ?? payload.service ?? labels.service ?? record.service ?? null;
    const rawSeverity = String(candidate.policy?.severity || payload.severity || candidate.severity || input.severity || 'error').toLowerCase();
    const severity = rawSeverity === 'critical' || rawSeverity === 'fatal'
        ? 'critical'
        : rawSeverity === 'warning'
            ? 'warning'
            : rawSeverity === 'info' || rawSeverity === 'debug'
                ? 'info'
                : 'error';
    const kind = (candidate.kind ?? payload.kind) === 'recovered' ? 'recovered' : 'fired';
    const ruleId = String(candidate.policy?.ruleId || payload.ruleId || input.ruleId || '');
    const ruleName = String(candidate.policy?.ruleName || payload.ruleName || annotations.title || policy.name || policy.ruleName || (ruleId ? `Rule ${ruleId.slice(0, 8)}` : 'Alert Rule')).replace(/^(Alert|Recovered):\s*/i, '').trim();
    // Extract Route / Endpoint
    const endpoint = String(candidate.endpoint
        || payload.endpoint
        || record.route
        || record.url
        || record.path
        || event.route
        || event.path
        || labels.route
        || labels.endpoint
        || values.route
        || '').trim() || undefined;
    // Extract HTTP Method
    const method = String(record.method
        || record.httpMethod
        || event.method
        || record.req?.method
        || labels.method
        || '').trim() || undefined;
    // Extract HTTP Status Code
    const rawStatus = values.requests?.status_code
        ?? record.statusCode
        ?? record.status_code
        ?? event.statusCode
        ?? event.status_code
        ?? values.status_code;
    const statusCode = rawStatus !== undefined && rawStatus !== null && String(rawStatus).trim() !== ''
        ? Number(rawStatus) || String(rawStatus)
        : undefined;
    // Extract Latency / Duration
    const rawObserved = candidate.observedValue
        ?? (typeof payload.observedValue === 'number' ? payload.observedValue : null)
        ?? values.latency_ms
        ?? values.duration_ms
        ?? record.latencyMs
        ?? record.durationMs
        ?? record.latency
        ?? record.duration;
    const observedValue = typeof rawObserved === 'number' && Number.isFinite(rawObserved) ? rawObserved : null;
    const rawThreshold = candidate.thresholdValue
        ?? (typeof payload.thresholdValue === 'number' ? payload.thresholdValue : null);
    const thresholdValue = typeof rawThreshold === 'number' && Number.isFinite(rawThreshold) ? rawThreshold : null;
    // Category and condition checks
    const conditionPaths = candidate.conditionFieldPaths
        ?? (Array.isArray(policy.conditions) ? policy.conditions.map((c) => c.field_path) : []);
    const category = candidate.category
        || payload.category
        || (conditionPaths.some((p) => String(p).includes('latency') || String(p).includes('duration')) ? 'performance' : 'all');
    const isLatency = category === 'performance'
        || /latency|duration|response_time|p95|p99/i.test(ruleName)
        || conditionPaths.some((p) => /latency|duration|response_time/i.test(String(p)));
    const isError = category === 'errors'
        || category === 'error'
        || /error|5xx|exception|fail|crash|unhandled/i.test(ruleName)
        || conditionPaths.some((p) => /error|5xx|unhandled|fatal/i.test(String(p)));
    // Formatted observed & threshold
    const fieldHint = conditionPaths[0] || (isLatency ? 'latency_ms' : '');
    const observedFormatted = payload.observedFormatted
        || (observedValue !== null ? formatMetricValue(observedValue, fieldHint) : undefined);
    const thresholdFormatted = payload.thresholdFormatted
        || (thresholdValue !== null ? formatMetricValue(thresholdValue, fieldHint) : undefined);
    const durationMs = observedValue ?? (typeof payload.durationMs === 'number' ? payload.durationMs : undefined);
    const timeTakenFormatted = payload.timeTakenFormatted
        || (durationMs !== undefined ? formatDuration(durationMs) : undefined);
    // Extract Trace ID & Span ID
    const traceId = String(payload.traceId
        || payload.metadata?.traceId
        || event.traceId
        || event.trace_id
        || record.traceId
        || record.trace_id
        || event.tags?.trace_id
        || record.tags?.trace_id
        || event.metadata?.traceId
        || '').trim() || undefined;
    const spanId = String(payload.spanId
        || payload.metadata?.spanId
        || event.spanId
        || event.span_id
        || record.spanId
        || record.span_id
        || '').trim() || undefined;
    // Extract Client IP & User Agent
    const clientIp = String(payload.clientIp
        || payload.metadata?.clientIp
        || record.ip
        || record.clientIp
        || record.client_ip
        || event.ip
        || record.req?.ip
        || record.remoteAddress
        || '').trim() || undefined;
    const userAgent = String(payload.userAgent
        || payload.metadata?.userAgent
        || record.userAgent
        || record.user_agent
        || event.userAgent
        || record.req?.headers?.['user-agent']
        || '').trim() || undefined;
    // Extract Error Message
    const rawErrorMessage = values.errors?.message
        || values.logs?.message
        || record.message
        || record.error
        || record.exception
        || event.message
        || '';
    const errorMessage = typeof rawErrorMessage === 'string' && rawErrorMessage.trim() ? rawErrorMessage.trim() : undefined;
    const errorType = typeof record.errorType === 'string' ? record.errorType : typeof record.name === 'string' ? record.name : undefined;
    const stackSnippet = typeof record.stack === 'string' ? record.stack.slice(0, 500) : undefined;
    // Timestamp
    const rawObservedAt = candidate.observedAt || payload.occurredAt || event.timestamp || record.timestamp || new Date();
    const occurredAt = rawObservedAt instanceof Date ? rawObservedAt : new Date(rawObservedAt);
    const occurredAtFormatted = formatTimestamp(occurredAt);
    const alertKey = input.alertKey || candidate.alertKey || payload.alertKey || 'default';
    const alertEventId = input.alertEventId || payload.alertEventId || undefined;
    const projectName = candidate.projectName || payload.projectName || (projectId ? `Project ${projectId.slice(0, 8)}` : null);
    const orgName = candidate.orgName || payload.orgName || null;
    const source = candidate.source || payload.source || 'telemetry';
    // URLs
    const baseUrl = getAppBaseUrl();
    const alertUrl = projectId
        ? `${baseUrl}/projects/${projectId}/alerts/${alertKey}`
        : `${baseUrl}/alerts/${alertKey}`;
    const traceUrl = projectId && traceId
        ? `${baseUrl}/projects/${projectId}/traces/${traceId}`
        : undefined;
    const acknowledgeUrl = `${alertUrl}?action=ack`;
    const silenceUrl = `${alertUrl}?action=silence`;
    const preferencesUrl = `${baseUrl}/settings/notifications`;
    // Scope label for subject
    const scopeParts = [];
    if (projectName)
        scopeParts.push(projectName);
    if (environment)
        scopeParts.push(`(${environment})`);
    const scopeStr = scopeParts.length > 0 ? scopeParts.join(' ') : (orgName || '');
    const escalationStep = input.escalationStep || payload.escalationStep || undefined;
    // Subject line computation
    let subject;
    if (kind === 'recovered') {
        subject = `[RESOLVED] ${ruleName}${endpoint ? ` · ${endpoint}` : ''}${scopeStr ? ` — ${scopeStr}` : ''}`;
    }
    else if (escalationStep) {
        subject = `[ESCALATED S${escalationStep} · ${severity.toUpperCase()}] ${ruleName}${endpoint ? `: ${endpoint}` : ''}${scopeStr ? ` — ${scopeStr}` : ''}`;
    }
    else if (isLatency) {
        const metricSummary = observedFormatted && thresholdFormatted ? ` (${observedFormatted} > ${thresholdFormatted})` : observedFormatted ? ` (${observedFormatted})` : '';
        subject = `[FIRING · ${severity.toUpperCase()}] ${ruleName}${endpoint ? `: ${endpoint}` : ''}${metricSummary}${scopeStr ? ` — ${scopeStr}` : ''}`;
    }
    else if (isError) {
        const errorDetail = endpoint ? `: ${endpoint}` : '';
        const metricSummary = observedFormatted && thresholdFormatted ? ` (${observedFormatted} > ${thresholdFormatted})` : '';
        subject = `[FIRING · ${severity.toUpperCase()}] ${ruleName}${errorDetail}${metricSummary}${scopeStr ? ` — ${scopeStr}` : ''}`;
    }
    else {
        const metricSummary = observedFormatted && thresholdFormatted ? ` (${observedFormatted} > ${thresholdFormatted})` : '';
        subject = `[FIRING · ${severity.toUpperCase()}] ${ruleName}${endpoint ? ` · ${endpoint}` : ''}${metricSummary}${scopeStr ? ` — ${scopeStr}` : ''}`;
    }
    // Summary computation
    let summary;
    if (kind === 'recovered') {
        summary = `${ruleName} has recovered and is no longer breaching threshold${endpoint ? ` on ${endpoint}` : ''}.`;
    }
    else if (isLatency && endpoint && observedFormatted && thresholdFormatted) {
        summary = `High latency detected on ${method ? `${method} ` : ''}${endpoint}. Measured response time reached ${observedFormatted}, exceeding the configured threshold of ${thresholdFormatted}.`;
    }
    else if (isLatency && observedFormatted) {
        summary = `Response time reached ${observedFormatted}${thresholdFormatted ? ` (threshold ${thresholdFormatted})` : ''}${endpoint ? ` on ${endpoint}` : ''}.`;
    }
    else if (isError && errorMessage) {
        summary = `Error occurred${endpoint ? ` on ${endpoint}` : ''}: ${errorMessage}`;
    }
    else if (observedFormatted && thresholdFormatted) {
        summary = `${ruleName} breached threshold: measured ${observedFormatted} vs threshold of ${thresholdFormatted}.`;
    }
    else {
        summary = `${ruleName} triggered an alert notification${endpoint ? ` on ${endpoint}` : ''}.`;
    }
    // Structured Fields for Connectors / Tables
    const fields = [];
    fields.push({ label: 'Rule', value: ruleName, short: true });
    fields.push({ label: 'Severity', value: severity.toUpperCase(), short: true });
    if (endpoint)
        fields.push({ label: 'Route', value: endpoint, short: true });
    if (method)
        fields.push({ label: 'Method', value: method.toUpperCase(), short: true });
    if (statusCode !== undefined)
        fields.push({ label: 'Status Code', value: String(statusCode), short: true });
    if (timeTakenFormatted)
        fields.push({ label: 'Time Taken', value: timeTakenFormatted, short: true });
    if (thresholdFormatted)
        fields.push({ label: 'Threshold', value: thresholdFormatted, short: true });
    if (projectName)
        fields.push({ label: 'Project', value: projectName, short: true });
    if (environment)
        fields.push({ label: 'Environment', value: environment, short: true });
    fields.push({ label: 'Occurred At', value: occurredAtFormatted, short: false });
    if (traceId)
        fields.push({ label: 'Trace ID', value: traceId, short: false });
    if (spanId)
        fields.push({ label: 'Span ID', value: spanId, short: true });
    if (clientIp)
        fields.push({ label: 'Client IP', value: clientIp, short: true });
    if (errorMessage)
        fields.push({ label: 'Error Message', value: errorMessage, short: false });
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
        observedValue,
        thresholdValue,
        observedFormatted,
        thresholdFormatted,
        endpoint,
        method,
        statusCode,
        durationMs,
        timeTakenFormatted,
        occurredAt,
        occurredAtFormatted,
        traceId,
        spanId,
        clientIp,
        userAgent,
        errorMessage,
        errorType,
        stackSnippet,
        projectId,
        projectName,
        environment,
        service,
        organizationId,
        orgName,
        source,
        summary,
        subject,
        fields,
        alertUrl,
        traceUrl,
        acknowledgeUrl,
        silenceUrl,
        preferencesUrl,
        escalationStep,
        policyName: policy.name || payload.policyName,
        rawEvidence: evidence,
        rawPolicy: policy,
    };
}
/**
 * Build rich, structured NotificationPayload for alerting jobs.
 */
export function buildAlertNotificationPayload(candidate, routingDecisionHash) {
    const ctx = extractAlertContext({ candidate });
    const payload = {
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
            durationMs: ctx.durationMs,
            timeTakenFormatted: ctx.timeTakenFormatted,
            traceId: ctx.traceId,
            spanId: ctx.spanId,
            clientIp: ctx.clientIp,
            userAgent: ctx.userAgent,
            errorMessage: ctx.errorMessage,
            occurredAt: ctx.occurredAt.toISOString(),
            occurredAtFormatted: ctx.occurredAtFormatted,
            projectId: ctx.projectId,
            projectName: ctx.projectName,
            environment: ctx.environment,
            service: ctx.service,
            organizationId: ctx.organizationId,
            subject: ctx.subject,
            summary: ctx.summary,
            traceUrl: ctx.traceUrl,
            acknowledgeUrl: ctx.acknowledgeUrl,
            silenceUrl: ctx.silenceUrl,
            preferencesUrl: ctx.preferencesUrl,
            policy: candidate.policy,
            evidence: candidate.evidence ?? {},
            annotations: candidate.annotations ?? {},
            routingDecisionHash: routingDecisionHash ?? null,
        },
        // Top-level aliases for consumers reading directly from payload
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
    return payload;
}
/**
 * Render Sentinel Mono enterprise email for any alert job data.
 */
export function renderEnterpriseAlertEmail(jobData) {
    const payload = jobData.payload ?? {};
    const metadata = (payload.metadata ?? {});
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
        orgName: ctx.orgName ?? undefined,
        projectName: ctx.projectName ?? undefined,
        environment: ctx.environment ?? undefined,
        alertUrl: ctx.alertUrl,
        acknowledgeUrl: ctx.acknowledgeUrl,
        silenceUrl: ctx.silenceUrl,
        preferencesUrl: ctx.preferencesUrl,
    };
    const extraRows = [];
    if (ctx.traceUrl) {
        extraRows.push({ label: 'Trace link', value: ctx.traceUrl });
    }
    let template;
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
    }
    else if (ctx.escalationStep) {
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
                traceId: ctx.traceId,
                spanId: ctx.spanId,
                clientIp: ctx.clientIp,
                fingerprint: ctx.alertKey,
                eventId: ctx.alertEventId,
                source: ctx.source,
            },
            policyName: ctx.policyName || 'Default Escalation Policy',
            stepNumber: ctx.escalationStep,
        });
    }
    else if (ctx.isLatency && (ctx.observedFormatted || ctx.thresholdFormatted || ctx.endpoint)) {
        // 3. High Latency Alert
        template = latencyAlertTemplate({
            ...scope,
            percentile: ctx.ruleName.includes('p99') ? 'p99' : ctx.ruleName.includes('p90') ? 'p90' : 'p95',
            observed: ctx.observedFormatted || ctx.timeTakenFormatted || 'Breached',
            threshold: ctx.thresholdFormatted || 'Configured limit',
            endpoint: ctx.endpoint,
            method: ctx.method,
            statusCode: ctx.statusCode,
            traceId: ctx.traceId,
            spanId: ctx.spanId,
            clientIp: ctx.clientIp,
            service: ctx.service ?? undefined,
            severity: ctx.severity,
            startedAt: ctx.occurredAtFormatted,
            extraRows: extraRows.length > 0 ? extraRows : undefined,
        });
    }
    else if (ctx.isError && ctx.observedFormatted && ctx.thresholdFormatted) {
        // 4. Error Rate Spike
        template = errorSpikeTemplate({
            ...scope,
            errorRate: ctx.observedFormatted,
            threshold: ctx.thresholdFormatted,
            endpoint: ctx.endpoint,
            method: ctx.method,
            topStatusCode: ctx.statusCode ? String(ctx.statusCode) : undefined,
            topError: ctx.errorMessage,
            traceId: ctx.traceId,
            spanId: ctx.spanId,
            clientIp: ctx.clientIp,
            service: ctx.service ?? undefined,
            severity: ctx.severity,
            startedAt: ctx.occurredAtFormatted,
            extraRows: extraRows.length > 0 ? extraRows : undefined,
        });
    }
    else {
        // 5. Standard Alert Firing
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
                traceId: ctx.traceId,
                spanId: ctx.spanId,
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
    return {
        ...template,
        subject: ctx.subject,
    };
}
//# sourceMappingURL=alert-notification-formatter.js.map
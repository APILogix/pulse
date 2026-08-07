export const AI_INTENT_VALUES = [
    'explain', 'root_cause', 'find_similar', 'performance', 'security', 'optimization', 'incident_summary', 'ask',
];
export const AI_INTENTS = AI_INTENT_VALUES;
/** Seed fields safe to include verbatim (bounded). Everything else is dropped. */
const SEED_ALLOW = new Set([
    'id', 'timestamp', 'occurred_at', 'environment', 'service', 'endpoint', 'release', 'severity', 'level',
    'method', 'url', 'route', 'status_code', 'latency_ms', 'duration_ms', 'message', 'name',
    'error_name', 'fingerprint', 'source', 'mechanism', 'trace_id', 'span_id', 'request_id',
    'user_id', 'db_system', 'db_operation', 'http_status_code', 'kind', 'status', 'metric_name',
    'metric_type', 'metric_unit', 'metric_category', 'aggregation_type', 'value', 'unit', 'monitor_slug', 'profile_type', 'sdk_name', 'sdk_version',
]);
const MAX_STR = 500;
function truncate(value) {
    if (typeof value === 'string' && value.length > MAX_STR)
        return `${value.slice(0, MAX_STR)}…`;
    return value;
}
/** Keep only allow-listed, bounded seed fields (drops bodies, headers, PII blobs). */
export function sanitizeSeed(seed) {
    const out = {};
    for (const [key, value] of Object.entries(seed)) {
        if (!SEED_ALLOW.has(key))
            continue;
        if (value === null || value === undefined)
            continue;
        out[key] = truncate(value);
    }
    return out;
}
function topValues(rows, field, limit = 3) {
    const counts = new Map();
    for (const row of rows) {
        const v = row[field];
        if (typeof v === 'string' && v.length > 0)
            counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([v, c]) => `${v} (${c})`);
}
/** Derive human-readable facts from the seed + correlated bundle. */
export function extractFacts(resource, seed, bundle) {
    const facts = [];
    const s = seed;
    if (resource === 'requests') {
        facts.push(`Request ${str(s.method)} ${str(s.route ?? s.url)} → status ${str(s.status_code)} in ${str(s.latency_ms)}ms`);
    }
    else if (resource === 'errors') {
        facts.push(`Error ${str(s.error_name)} (${str(s.severity)}): ${str(s.message)}`);
        if (s.fingerprint)
            facts.push(`Fingerprint: ${str(s.fingerprint)}`);
    }
    else if (resource === 'logs') {
        facts.push(`Log [${str(s.level)}] ${str(s.message)} from ${str(s.logger ?? s.service)}`);
    }
    else if (resource === 'traces') {
        facts.push(`Trace ${str(s.root_span_name)} with ${str(s.span_count)} spans over ${str(s.total_duration_ms)}ms`);
    }
    else if (resource === 'spans') {
        facts.push(`Span ${str(s.name)} (${str(s.kind)}) status=${str(s.status)} in ${str(s.duration_ms)}ms`);
    }
    else if (resource === 'metrics') {
        facts.push(`Metric ${str(s.metric_name)}=${str(s.value)}${str(s.metric_unit ?? s.unit)} (${str(s.metric_type)})`);
    }
    else if (resource === 'crons') {
        facts.push(`Cron ${str(s.monitor_slug)} status=${str(s.status)}`);
    }
    else if (resource === 'profiles') {
        facts.push(`Profile ${str(s.profile_type)} over ${str(s.duration_ms)}ms`);
    }
    if (s.service)
        facts.push(`Service: ${str(s.service)}`);
    if (s.environment)
        facts.push(`Environment: ${str(s.environment)}`);
    if (s.release)
        facts.push(`Release: ${str(s.release)}`);
    const c = bundle.counts;
    facts.push(`Correlated: ${c.errors} errors, ${c.logs} logs, ${c.spans} spans, ${c.requests} requests, ${c.metrics} metrics.`);
    const topErrors = topValues(bundle.relatedErrors, 'errorName');
    if (topErrors.length > 0)
        facts.push(`Top correlated errors: ${topErrors.join(', ')}`);
    const slowSpans = bundle.spans
        .filter((sp) => typeof sp.durationMs === 'number')
        .sort((a, b) => b.durationMs - a.durationMs)
        .slice(0, 3)
        .map((sp) => `${str(sp.name)} (${str(sp.durationMs)}ms)`);
    if (slowSpans.length > 0)
        facts.push(`Slowest spans: ${slowSpans.join(', ')}`);
    return facts;
}
export function assembleContext(resource, seed, bundle, timeline) {
    const sanitized = sanitizeSeed(seed);
    return {
        resource,
        seed: sanitized,
        keys: bundle.keys,
        counts: bundle.counts,
        facts: extractFacts(resource, seed, bundle),
        timeline,
    };
}
const INTENT_INSTRUCTION = {
    explain: 'Explain what this telemetry event represents and what happened, in plain language.',
    root_cause: 'Determine the most likely root cause using the correlated evidence. Be specific.',
    find_similar: 'Describe the signature of this event so similar events can be found, and list distinguishing attributes.',
    performance: 'Analyze the performance characteristics (latency, slow spans, bottlenecks) and where time is spent.',
    security: 'Assess any security implications (auth failures, injection indicators, suspicious access, data exposure).',
    optimization: 'Recommend concrete optimizations to prevent recurrence or improve performance.',
    incident_summary: 'Write a concise incident summary suitable for an on-call handoff.',
    ask: 'Answer the operator question using only the provided telemetry context.',
};
/** Build the model prompts for an intent. Output is always requested as JSON. */
export function buildPrompts(context, intent, question) {
    const system = [
        'You are Pulse, an enterprise observability investigation assistant.',
        'You receive correlated telemetry assembled by the backend. Use ONLY this context.',
        'Respond as strict JSON with keys: summary (string), findings (string[]), rootCause (string|null), recommendations (string[]), confidence (number 0-1).',
        'Be precise and actionable. Do not fabricate data that is not present.',
    ].join(' ');
    const payload = {
        intent,
        instruction: INTENT_INSTRUCTION[intent],
        question: intent === 'ask' ? (question ?? '') : undefined,
        resource: context.resource,
        event: context.seed,
        correlationKeys: context.keys,
        correlationCounts: context.counts,
        facts: context.facts,
        timeline: context.timeline.slice(-48),
    };
    return { system, user: JSON.stringify(payload) };
}
function str(value) {
    if (value === null || value === undefined)
        return '';
    return String(value);
}
//# sourceMappingURL=context-assembler.js.map
import { errorsResource, tracesResource, requestsResource, logsResource, errorGroupsResource, } from '../observability/resources/index.js';
import { AIRepositoryError } from './repository.js';
/**
 * Normalizes input public ID to match database conventions while tolerating
 * diverse casing and prefix styles (e.g. `ERR-000000001`, `err_01...`, `REQ-1`, `req_...`).
 */
export function normalizePublicId(rawId, resource) {
    const trimmed = rawId.trim();
    const upper = trimmed.toUpperCase();
    // If already standard prefix format (e.g. ERR-000000001)
    if (/^[A-Z]{3,4}-\d{1,12}$/.test(upper)) {
        return upper;
    }
    // If underscore prefix (e.g. err_01JXYZ... or err_000000001)
    if (trimmed.includes('_')) {
        const parts = trimmed.split('_');
        const prefix = parts[0]?.toLowerCase();
        const rest = parts.slice(1).join('_');
        if (/^\d+$/.test(rest)) {
            const num = rest.padStart(9, '0');
            if (prefix === 'err' || prefix === 'error')
                return `ERR-${num}`;
            if (prefix === 'req' || prefix === 'request')
                return `REQ-${num}`;
            if (prefix === 'trc' || prefix === 'trace')
                return `TRC-${num}`;
            if (prefix === 'log' || prefix === 'logs')
                return `LOG-${num}`;
            if (prefix === 'iss' || prefix === 'issue')
                return `ISS-${num}`;
        }
    }
    return trimmed;
}
function resolveExplorerResource(resource) {
    switch (resource) {
        case 'error':
            return errorsResource;
        case 'trace':
            return tracesResource;
        case 'request':
            return requestsResource;
        case 'log':
        case 'logs':
            return logsResource;
        default:
            throw new AIRepositoryError(`Unsupported investigation resource: ${resource}`, 'INVALID_REQUEST');
    }
}
function formatStackTrace(raw) {
    if (typeof raw.stack_trace === 'string' && raw.stack_trace.trim()) {
        return raw.stack_trace.trim();
    }
    if (typeof raw.stack === 'string' && raw.stack.trim()) {
        return raw.stack.trim();
    }
    if (Array.isArray(raw.stack_frames) && raw.stack_frames.length > 0) {
        return raw.stack_frames
            .map((f) => {
            if (!f || typeof f !== 'object')
                return '';
            const fn = f.function ?? f.method ?? '<anonymous>';
            const file = f.filename ?? f.file ?? 'unknown';
            const line = f.lineno ?? f.line ?? '?';
            const col = f.colno ?? f.col ?? '?';
            return `    at ${fn} (${file}:${line}:${col})`;
        })
            .filter(Boolean)
            .join('\n');
    }
    return undefined;
}
function sanitizeRecord(row) {
    if (!row || typeof row !== 'object')
        return undefined;
    const out = {};
    for (const [k, v] of Object.entries(row)) {
        if (v === null || v === undefined)
            continue;
        if (typeof v === 'string') {
            out[k] = v.length > 1000 ? `${v.slice(0, 1000)}…` : v;
        }
        else if (typeof v === 'number' || typeof v === 'boolean') {
            out[k] = v;
        }
        else if (Array.isArray(v)) {
            out[k] = v.slice(0, 20);
        }
        else if (typeof v === 'object') {
            out[k] = v;
        }
    }
    return out;
}
/**
 * Resolves the complete, normalized AI context for an investigation request.
 */
export async function resolveInvestigationContext(orgId, userId, resource, publicId, deps) {
    // 1. Resolve tenant membership & project visibility (multi-tenant boundary)
    const ctx = await deps.resolver.resolve({ organizationId: orgId, userId });
    // 2. Resolve explorer resource definition
    const explorerResource = resolveExplorerResource(resource);
    // 3. Normalize public ID and query seed entity with project isolation
    const normalizedId = normalizePublicId(publicId, resource);
    let seedRow = await deps.repository.fetchRawById(explorerResource, ctx, normalizedId);
    if (!seedRow && normalizedId !== publicId) {
        seedRow = await deps.repository.fetchRawById(explorerResource, ctx, publicId);
    }
    // If error and ID starts with ISS-, try latest error for group
    if (!seedRow && resource === 'error' && (normalizedId.toUpperCase().startsWith('ISS-') || publicId.toUpperCase().startsWith('ISS-'))) {
        seedRow = await deps.repository.fetchLatestErrorForGroup(ctx, normalizedId);
    }
    if (!seedRow) {
        throw new AIRepositoryError(`Resource ${resource} with ID '${publicId}' not found or you do not have permission to access its project.`, 'NOT_FOUND');
    }
    // 4. Correlate related telemetry across errors, traces, requests, logs, spans, etc.
    const resourceName = resource === 'log' ? 'logs' : resource === 'error' ? 'errors' : resource === 'trace' ? 'traces' : resource === 'request' ? 'requests' : resource;
    const bundle = await deps.correlation.correlate(resourceName, ctx, seedRow);
    // 5. Construct normalized AI input according to resource kind
    let aiInput;
    switch (resource) {
        case 'error': {
            const errorName = String(seedRow.error_name ?? seedRow.name ?? 'Error');
            const message = String(seedRow.message ?? '');
            const stackTrace = formatStackTrace(seedRow);
            // Fetch error group public ID if available
            let errorGroupPublicId = seedRow.error_group_public_id;
            if (!errorGroupPublicId && (seedRow.error_group_id || seedRow.fingerprint)) {
                errorGroupPublicId = (await deps.repository.fetchErrorGroupPublicId(ctx, seedRow.error_group_id ?? null, seedRow.fingerprint ?? null)) ?? undefined;
            }
            aiInput = {
                ai_mode: 'AI_ROOT_CAUSE_ANALYSIS',
                service_name: typeof seedRow.service === 'string' ? seedRow.service : undefined,
                environment_name: typeof seedRow.environment === 'string' ? seedRow.environment : undefined,
                severity: typeof seedRow.severity === 'string' ? seedRow.severity : 'error',
                exception_type: errorName,
                exception_message: message,
                stack_trace: stackTrace,
                user_query: `Investigate root cause of ${errorName}: ${message} (Error ID: ${seedRow.public_id ?? publicId})`,
                error_payload: {
                    public_id: seedRow.public_id ?? publicId,
                    error_name: errorName,
                    message,
                    error_group_public_id: errorGroupPublicId,
                    fingerprint: seedRow.fingerprint,
                    culprit: seedRow.culprit,
                    handled: seedRow.handled,
                    route: seedRow.route,
                    method: seedRow.method,
                    status_code: seedRow.status_code,
                    release: seedRow.release ?? seedRow.app_version,
                    sdk: seedRow.sdk_name ? `${seedRow.sdk_name} v${seedRow.sdk_version ?? ''}` : undefined,
                    tags: sanitizeRecord(seedRow.tags),
                    context: sanitizeRecord(seedRow.context),
                    extra: sanitizeRecord(seedRow.extra),
                    correlated_counts: bundle.counts,
                },
                trace: bundle.trace ? sanitizeRecord(bundle.trace) : undefined,
                spans: bundle.spans.slice(0, 40).map((s) => sanitizeRecord(s)),
                logs: bundle.logs.slice(0, 40).map((l) => sanitizeRecord(l)),
            };
            break;
        }
        case 'trace': {
            const rootSpanName = String(seedRow.root_span_name ?? seedRow.name ?? 'Trace');
            const durationMs = Number(seedRow.total_duration_ms ?? seedRow.duration_ms ?? 0);
            const spanCount = Number(seedRow.span_count ?? 0);
            aiInput = {
                ai_mode: 'AI_TRACE_ANALYSIS',
                service_name: typeof seedRow.service === 'string' ? seedRow.service : undefined,
                environment_name: typeof seedRow.environment === 'string' ? seedRow.environment : undefined,
                user_query: `Analyze trace '${rootSpanName}' with ${spanCount} spans over ${durationMs}ms (Trace ID: ${seedRow.public_id ?? publicId})`,
                trace: {
                    public_id: seedRow.public_id ?? publicId,
                    trace_id: seedRow.trace_id,
                    root_span_name: rootSpanName,
                    total_duration_ms: durationMs,
                    span_count: spanCount,
                    root_span_status: seedRow.root_span_status ?? seedRow.status,
                    http_method: seedRow.http_method ?? seedRow.method,
                    endpoint: seedRow.endpoint ?? seedRow.route,
                    is_partial: seedRow.is_partial,
                    spans_tree: seedRow.spans_tree ? sanitizeRecord(seedRow.spans_tree) : undefined,
                    correlated_counts: bundle.counts,
                },
                spans: bundle.spans.slice(0, 50).map((s) => sanitizeRecord(s)),
                logs: bundle.logs.slice(0, 40).map((l) => sanitizeRecord(l)),
                error_payload: bundle.relatedErrors.length > 0 ? { related_errors: bundle.relatedErrors.slice(0, 20) } : undefined,
            };
            break;
        }
        case 'request': {
            const method = String(seedRow.method ?? 'GET');
            const endpoint = String(seedRow.endpoint ?? seedRow.route ?? seedRow.url ?? '/');
            const statusCode = Number(seedRow.status_code ?? 200);
            const durationMs = Number(seedRow.duration_ms ?? seedRow.latency_ms ?? 0);
            aiInput = {
                ai_mode: 'AI_ROOT_CAUSE_ANALYSIS',
                service_name: typeof seedRow.service === 'string' ? seedRow.service : undefined,
                environment_name: typeof seedRow.environment === 'string' ? seedRow.environment : undefined,
                severity: seedRow.is_error || statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'low',
                user_query: `Investigate request ${method} ${endpoint} (HTTP ${statusCode}, ${durationMs}ms) (Request ID: ${seedRow.public_id ?? publicId})`,
                error_payload: {
                    public_id: seedRow.public_id ?? publicId,
                    request_id: seedRow.request_id,
                    method,
                    endpoint,
                    status_code: statusCode,
                    duration_ms: durationMs,
                    is_slow: seedRow.is_slow,
                    is_error: seedRow.is_error,
                    browser: seedRow.browser_family,
                    os: seedRow.os_name,
                    device: seedRow.device_type,
                    geo_country: seedRow.geo_country_code,
                    correlated_errors: bundle.relatedErrors.slice(0, 20),
                    correlated_counts: bundle.counts,
                },
                trace: bundle.trace ? sanitizeRecord(bundle.trace) : undefined,
                spans: bundle.spans.slice(0, 40).map((s) => sanitizeRecord(s)),
                logs: bundle.logs.slice(0, 40).map((l) => sanitizeRecord(l)),
            };
            break;
        }
        case 'log':
        case 'logs': {
            const level = String(seedRow.level ?? 'info');
            const message = String(seedRow.message ?? '');
            aiInput = {
                ai_mode: 'AI_LOG_SUMMARY',
                service_name: typeof seedRow.service === 'string' ? seedRow.service : undefined,
                environment_name: typeof seedRow.environment === 'string' ? seedRow.environment : undefined,
                severity: level === 'error' || level === 'fatal' ? 'error' : level === 'warn' || level === 'warning' ? 'warn' : 'info',
                user_query: `Analyze log entry [${level.toUpperCase()}] ${message} (Log ID: ${seedRow.public_id ?? publicId})`,
                logs: [
                    {
                        public_id: seedRow.public_id ?? publicId,
                        occurred_at: seedRow.occurred_at,
                        level,
                        message,
                        logger: seedRow.logger ?? seedRow.logger_name,
                        log_category: seedRow.log_category,
                        log_source: seedRow.log_source,
                        endpoint: seedRow.endpoint,
                        service: seedRow.service,
                    },
                    ...bundle.logs.slice(0, 40).map((l) => sanitizeRecord(l)),
                ],
                trace: bundle.trace ? sanitizeRecord(bundle.trace) : undefined,
                spans: bundle.spans.slice(0, 30).map((s) => sanitizeRecord(s)),
                error_payload: bundle.relatedErrors.length > 0 ? { related_errors: bundle.relatedErrors.slice(0, 20) } : undefined,
            };
            break;
        }
    }
    return { aiInput, ctx, seedRow };
}
//# sourceMappingURL=investigation-context.js.map
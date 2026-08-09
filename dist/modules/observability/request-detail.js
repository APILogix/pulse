/**
 * Request event detail assembler.
 *
 * Transforms a raw `events_requests` row + lightweight correlated data into the
 * sectioned payload the frontend expects for the request detail page. The
 * backend does NOT expose the raw payload; it extracts only the well-known HTTP
 * fields and leaves everything else behind.
 */
import { isRequestPublicId, assertRequestPublicId } from './public-id.js';
export { isRequestPublicId, assertRequestPublicId } from './public-id.js';
const SENSITIVE_KEY_RE = /^(authorization|cookie|set-cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key|access[_-]?key|refresh[_-]?token|x-api-key|x-auth-token)$/i;
const PAYLOAD_QUERY_KEYS = ['query', 'queryParameters', 'query_params', 'queryString'];
const PAYLOAD_ROUTE_PARAM_KEYS = ['routeParameters', 'route_params', 'pathParams', 'params'];
const PAYLOAD_REQUEST_HEADER_KEYS = ['headers', 'requestHeaders', 'request_headers'];
const PAYLOAD_RESPONSE_HEADER_KEYS = ['responseHeaders', 'response_headers'];
const PAYLOAD_REQUEST_BODY_KEYS = ['body', 'requestBody', 'request_body'];
const PAYLOAD_RESPONSE_BODY_KEYS = ['responseBody', 'response_body'];
function asString(value) {
    if (typeof value === 'string' && value.length > 0)
        return value;
    return null;
}
function asNumber(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
function asBoolean(value) {
    if (typeof value === 'boolean')
        return value;
    return null;
}
function asIsoTimestamp(value) {
    if (value instanceof Date)
        return value.toISOString();
    if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    return null;
}
function asRecord(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value;
    }
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed;
            }
        }
        catch {
            // fall through to empty object
        }
    }
    return {};
}
function extractPayloadField(payload, keys) {
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) {
            return payload[key];
        }
    }
    return undefined;
}
function buildSdkChip(sdkName, sdkVersion) {
    if (!sdkName && !sdkVersion)
        return null;
    if (!sdkVersion)
        return sdkName;
    return `${sdkName}@${sdkVersion}`;
}
function buildTags(raw) {
    const tags = [];
    const add = (key, label, value) => {
        if (value !== null && value !== undefined && value !== '') {
            tags.push({ key, label, value });
        }
    };
    add('environment', 'Environment', asString(raw.environment));
    add('service', 'Service', asString(raw.service));
    add('release', 'Release', asString(raw.release));
    add('sdk', 'SDK', buildSdkChip(asString(raw.sdk_name), asString(raw.sdk_version)));
    add('browser', 'Browser', asString(raw.browser_family));
    add('os', 'OS', asString(raw.os_name));
    add('device', 'Device', asString(raw.device_type));
    add('method', 'Method', asString(raw.method));
    const status = asNumber(raw.status_code);
    if (status !== null)
        add('status', 'Status', String(status));
    return tags;
}
/** Recursively mask sensitive header/body keys for developer-tools payloads. */
export function maskSensitiveValue(value) {
    if (Array.isArray(value)) {
        return value.map((item) => maskSensitiveValue(item));
    }
    if (value && typeof value === 'object') {
        const out = {};
        for (const [key, nested] of Object.entries(value)) {
            out[key] = SENSITIVE_KEY_RE.test(key) ? '[REDACTED]' : maskSensitiveValue(nested);
        }
        return out;
    }
    return value;
}
/**
 * Lazy developer-tools payload. Sensitive fields are masked; the canonical
 * detail response never includes these raw dumps by default.
 */
export function assembleRequestDeveloperTools(raw) {
    const payload = asRecord(raw.payload);
    const attributes = asRecord(raw.attributes);
    const metadata = asRecord(raw.metadata);
    const rawDatabaseRecord = maskSensitiveValue({
        ...raw,
        payload: undefined,
        attributes: undefined,
        metadata: undefined,
    });
    return {
        rawSdkEvent: maskSensitiveValue(payload),
        normalizedEvent: maskSensitiveValue({
            publicId: asString(raw.public_id),
            method: asString(raw.method),
            endpoint: asString(raw.endpoint),
            url: asString(raw.url ?? payload.url),
            statusCode: asNumber(raw.status_code),
            durationMs: asNumber(raw.duration_ms),
            occurredAt: asIsoTimestamp(raw.occurred_at),
            environment: asString(raw.environment),
            service: asString(raw.service),
            release: asString(raw.release),
            requestId: asString(raw.request_id),
            traceId: asString(raw.trace_id),
            userId: asString(raw.user_id),
            sessionId: asString(raw.session_id),
            attributes,
            metadata,
            http: {
                queryParameters: extractPayloadField(payload, PAYLOAD_QUERY_KEYS) ?? null,
                routeParameters: extractPayloadField(payload, PAYLOAD_ROUTE_PARAM_KEYS) ?? null,
                requestHeaders: extractPayloadField(payload, PAYLOAD_REQUEST_HEADER_KEYS) ?? null,
                responseHeaders: extractPayloadField(payload, PAYLOAD_RESPONSE_HEADER_KEYS) ?? null,
                requestBody: extractPayloadField(payload, PAYLOAD_REQUEST_BODY_KEYS) ?? null,
                responseBody: extractPayloadField(payload, PAYLOAD_RESPONSE_BODY_KEYS) ?? null,
            },
        }),
        rawDatabaseRecord,
    };
}
/**
 * Assemble the sectioned request detail response from a raw events_requests row
 * and the lightweight correlated data fetched by the service.
 *
 * The raw row is expected to be the output of `fetchRawById` for the
 * `requests` resource, so keys are the physical column names from the Log DB
 * (e.g. `public_id`, `duration_ms`, `trace_id`, ...).
 */
export function assembleRequestDetail(raw, related) {
    const payload = asRecord(raw.payload);
    const header = {
        publicId: asString(raw.public_id) ?? 'unknown',
        method: asString(raw.method),
        endpoint: asString(raw.endpoint),
        statusCode: asNumber(raw.status_code),
        duration: asNumber(raw.duration_ms),
        timestamp: asIsoTimestamp(raw.occurred_at),
        environment: asString(raw.environment),
        project: asString(raw.projectName ?? raw.project),
        service: asString(raw.service),
        release: asString(raw.release),
        tracePublicId: related.tracePublicId ?? asString(raw.tracePublicId) ?? asString(raw.trace_public_id) ?? null,
    };
    const summaryCards = {
        duration: asNumber(raw.duration_ms),
        status: asNumber(raw.status_code),
        responseSize: asNumber(raw.response_size),
        requestSize: asNumber(raw.body_size),
        spanCount: related.spanCount,
    };
    const http = {
        url: asString(raw.url ?? payload.url) ?? header.endpoint,
        endpoint: header.endpoint,
        method: header.method,
        queryParameters: extractPayloadField(payload, PAYLOAD_QUERY_KEYS) ?? null,
        routeParameters: extractPayloadField(payload, PAYLOAD_ROUTE_PARAM_KEYS) ?? null,
        requestHeaders: extractPayloadField(payload, PAYLOAD_REQUEST_HEADER_KEYS) ?? null,
        responseHeaders: extractPayloadField(payload, PAYLOAD_RESPONSE_HEADER_KEYS) ?? null,
        requestBody: extractPayloadField(payload, PAYLOAD_REQUEST_BODY_KEYS) ?? null,
        responseBody: extractPayloadField(payload, PAYLOAD_RESPONSE_BODY_KEYS) ?? null,
    };
    const trace = {
        publicId: header.tracePublicId,
    };
    const performance = {
        totalDuration: asNumber(raw.duration_ms),
        isSlow: asBoolean(raw.is_slow) ?? false,
    };
    const context = {
        user: asString(raw.user_id),
        session: asString(raw.session_id),
        tenant: asString(raw.tenant_id),
        sdk: buildSdkChip(asString(raw.sdk_name), asString(raw.sdk_version)),
        release: asString(raw.release),
        server: asString(raw.server_name),
        browser: asString(raw.browser_family),
        os: asString(raw.os_name),
        device: asString(raw.device_type),
        geo: {
            country: asString(raw.geo_country_code),
            region: asString(raw.geo_region),
            asn: asNumber(raw.geo_asn),
        },
    };
    const metadata = {
        attributes: asRecord(raw.attributes),
        metadata: asRecord(raw.metadata),
    };
    const relatedSection = {
        trace: { publicId: trace.publicId },
        errors: related.relatedErrors,
        logs: { count: related.logsCount },
    };
    return {
        header,
        summaryCards,
        http,
        trace,
        performance,
        context,
        metadata,
        ai: { aiResponse: raw.ai_response ?? null },
        related: relatedSection,
        tags: buildTags(raw),
    };
}
//# sourceMappingURL=request-detail.js.map
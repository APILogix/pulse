/**
 * Error event detail assembler.
 *
 * Transforms a raw `events_errors` row + lightweight correlated data into the
 * structured payload the frontend expects for the error detail page. The
 * backend does NOT expose the raw payload by default; it extracts only the
 * well-known fields and leaves internal payload fields behind.
 */
import { assertErrorPublicId, isErrorPublicId } from './public-id.js';
export { assertErrorPublicId, isErrorPublicId } from './public-id.js';
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
function asArray(value) {
    if (Array.isArray(value))
        return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed))
                return parsed;
        }
        catch {
            // fall through
        }
    }
    return [];
}
/**
 * Assemble the structured error detail response from a raw `events_errors` row
 * and the lightweight correlated data fetched by the service.
 *
 * The raw row is expected to be the output of `fetchRawById` for the `errors`
 * resource, so keys are the physical column names from the Log DB
 * (e.g. `public_id`, `error_name`, `trace_id`, ...).
 */
export function assembleErrorDetail(raw, related) {
    const errorGroupPublicId = related.errorGroupPublicId ??
        asString(raw.error_group_public_id) ??
        asString(raw.errorGroupPublicId) ??
        null;
    const tracePublicId = related.tracePublicId ??
        asString(raw.trace_public_id) ??
        asString(raw.tracePublicId) ??
        null;
    const requestPublicId = related.requestPublicId ??
        asString(raw.request_public_id) ??
        asString(raw.requestPublicId) ??
        null;
    return {
        id: asString(raw.id) ?? '',
        publicId: asString(raw.public_id) ?? 'unknown',
        occurredAt: asIsoTimestamp(raw.occurred_at),
        error: {
            name: asString(raw.error_name),
            message: asString(raw.message),
            severity: asString(raw.severity),
            handled: asBoolean(raw.handled) ?? null,
            mechanism: asString(raw.mechanism),
        },
        http: {
            method: asString(raw.method),
            route: asString(raw.route),
            url: asString(raw.url),
            statusCode: asNumber(raw.status_code),
            statusText: asString(raw.status_text),
        },
        environment: asString(raw.environment),
        project: {
            name: asString(raw.projectName ?? raw.project_name),
            slug: asString(raw.projectSlug ?? raw.project_slug ?? raw.project),
        },
        service: asString(raw.service),
        server: {
            name: asString(raw.server_name),
        },
        release: asString(raw.release),
        sdk: {
            name: asString(raw.sdk_name),
            version: asString(raw.sdk_version),
        },
        trace: {
            publicId: tracePublicId,
            traceId: asString(raw.trace_id),
        },
        errorGroup: {
            publicId: errorGroupPublicId,
        },
        request: {
            publicId: requestPublicId,
        },
        debugging: {
            stackFrames: asArray(raw.stack_frames),
            breadcrumbs: asArray(raw.breadcrumbs),
        },
        context: asRecord(raw.context),
        tags: asRecord(raw.tags),
        extra: asRecord(raw.extra),
        metadata: asRecord(raw.metadata),
        aiResponse: raw.ai_response ?? null,
        related: {
            errorGroup: { publicId: errorGroupPublicId },
            trace: { publicId: tracePublicId },
            request: { publicId: requestPublicId },
            logs: { count: related.logsCount },
        },
    };
}
//# sourceMappingURL=error-detail.js.map
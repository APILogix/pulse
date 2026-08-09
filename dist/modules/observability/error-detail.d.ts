export { assertErrorPublicId, isErrorPublicId } from './public-id.js';
export interface ErrorDetailResponse {
    id: string;
    publicId: string;
    occurredAt: string | null;
    error: {
        name: string | null;
        message: string | null;
        severity: string | null;
        handled: boolean | null;
        mechanism: string | null;
    };
    http: {
        method: string | null;
        route: string | null;
        url: string | null;
        statusCode: number | null;
        statusText: string | null;
    };
    environment: string | null;
    project: {
        name: string | null;
        slug: string | null;
    };
    service: string | null;
    server: {
        name: string | null;
    };
    release: string | null;
    sdk: {
        name: string | null;
        version: string | null;
    };
    trace: {
        publicId: string | null;
        traceId: string | null;
    };
    errorGroup: {
        publicId: string | null;
    };
    request: {
        publicId: string | null;
    };
    debugging: {
        stackFrames: unknown;
        breadcrumbs: unknown;
    };
    context: Record<string, unknown>;
    tags: Record<string, unknown>;
    extra: Record<string, unknown>;
    metadata: Record<string, unknown>;
    aiResponse: unknown;
    related: {
        errorGroup: {
            publicId: string | null;
        };
        trace: {
            publicId: string | null;
        };
        request: {
            publicId: string | null;
        };
        logs: {
            count: number;
        };
    };
}
export interface ErrorRelatedInput {
    errorGroupPublicId: string | null;
    tracePublicId: string | null;
    requestPublicId: string | null;
    logsCount: number;
}
/**
 * Assemble the structured error detail response from a raw `events_errors` row
 * and the lightweight correlated data fetched by the service.
 *
 * The raw row is expected to be the output of `fetchRawById` for the `errors`
 * resource, so keys are the physical column names from the Log DB
 * (e.g. `public_id`, `error_name`, `trace_id`, ...).
 */
export declare function assembleErrorDetail(raw: Record<string, unknown>, related: ErrorRelatedInput): ErrorDetailResponse;
//# sourceMappingURL=error-detail.d.ts.map
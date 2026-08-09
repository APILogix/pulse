export { isRequestPublicId, assertRequestPublicId } from './public-id.js';
export interface RequestDetailHeader {
    publicId: string;
    method: string | null;
    endpoint: string | null;
    statusCode: number | null;
    duration: number | null;
    timestamp: string | null;
    environment: string | null;
    project: string | null;
    service: string | null;
    release: string | null;
    tracePublicId: string | null;
}
export interface RequestSummaryCards {
    duration: number | null;
    status: number | null;
    responseSize: number | null;
    requestSize: number | null;
    spanCount: number | null;
}
export interface RequestHttpDetail {
    url: string | null;
    endpoint: string | null;
    method: string | null;
    queryParameters: unknown;
    routeParameters: unknown;
    requestHeaders: unknown;
    responseHeaders: unknown;
    requestBody: unknown;
    responseBody: unknown;
}
export interface RequestTraceDetail {
    publicId: string | null;
}
export interface RequestPerformanceDetail {
    totalDuration: number | null;
    isSlow: boolean | null;
}
export interface RequestContextDetail {
    user: string | null;
    session: string | null;
    tenant: string | null;
    sdk: string | null;
    release: string | null;
    server: string | null;
    browser: string | null;
    os: string | null;
    device: string | null;
    geo: {
        country: string | null;
        region: string | null;
        asn: number | null;
    };
}
export interface RequestMetadataDetail {
    attributes: Record<string, unknown>;
    metadata: Record<string, unknown>;
}
export interface RequestRelatedError {
    publicId: string;
    message: string;
}
export interface RequestRelatedDetail {
    trace: {
        publicId: string | null;
    };
    errors: RequestRelatedError[];
    logs: {
        count: number;
    };
}
export interface RequestTag {
    key: string;
    label: string;
    value: string;
}
export interface RequestDetailResponse {
    header: RequestDetailHeader;
    summaryCards: RequestSummaryCards;
    http: RequestHttpDetail;
    trace: RequestTraceDetail;
    performance: RequestPerformanceDetail;
    context: RequestContextDetail;
    metadata: RequestMetadataDetail;
    ai: {
        aiResponse: unknown;
    };
    related: RequestRelatedDetail;
    tags: RequestTag[];
}
export interface RequestRelatedInput {
    relatedErrors: RequestRelatedError[];
    logsCount: number;
    spanCount: number;
    tracePublicId: string | null;
}
export interface RequestDeveloperToolsResponse {
    rawSdkEvent: unknown;
    normalizedEvent: unknown;
    rawDatabaseRecord: unknown;
}
/** Recursively mask sensitive header/body keys for developer-tools payloads. */
export declare function maskSensitiveValue(value: unknown): unknown;
/**
 * Lazy developer-tools payload. Sensitive fields are masked; the canonical
 * detail response never includes these raw dumps by default.
 */
export declare function assembleRequestDeveloperTools(raw: Record<string, unknown>): RequestDeveloperToolsResponse;
/**
 * Assemble the sectioned request detail response from a raw events_requests row
 * and the lightweight correlated data fetched by the service.
 *
 * The raw row is expected to be the output of `fetchRawById` for the
 * `requests` resource, so keys are the physical column names from the Log DB
 * (e.g. `public_id`, `duration_ms`, `trace_id`, ...).
 */
export declare function assembleRequestDetail(raw: Record<string, unknown>, related: RequestRelatedInput): RequestDetailResponse;
//# sourceMappingURL=request-detail.d.ts.map
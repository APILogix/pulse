/**
 * Outbound HTTP helper for connectors.
 *
 * Centralizes timeout handling and error classification so every connector
 * maps network/HTTP failures into the same {@link FailureCategory} taxonomy
 * used by the dispatcher and dead-letter queue.
 */
import { type FailureCategory } from '../types.js';
export interface HttpRequestOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
}
export interface HttpResponse {
    ok: boolean;
    status: number;
    body: string;
    headers: Record<string, string>;
}
/**
 * Perform an HTTP request with a hard timeout. Network-level failures throw a
 * {@link ConnectorDeliveryError} so callers don't have to re-classify them.
 * HTTP responses (including 4xx/5xx) are returned as-is for the caller to
 * interpret per provider semantics.
 */
export declare function httpRequest(url: string, options?: HttpRequestOptions): Promise<HttpResponse>;
/**
 * Classify an HTTP status code into a retry decision + failure category.
 * - 2xx: success (callers handle separately)
 * - 408/429/5xx: retryable
 * - 401/403: auth error, not retryable
 * - other 4xx: invalid payload/config, not retryable
 */
export declare function classifyHttpStatus(status: number): {
    retryable: boolean;
    category: FailureCategory;
};
/** Strip query string + credentials from a URL for safe logging. */
export declare function redactUrl(url: string): string;
//# sourceMappingURL=http.d.ts.map
/**
 * Outbound HTTP helper for connectors.
 *
 * Centralizes timeout handling and error classification so every connector
 * maps network/HTTP failures into the same {@link FailureCategory} taxonomy
 * used by the dispatcher and dead-letter queue.
 */
import { ConnectorDeliveryError, type FailureCategory } from '../types.js';

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

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Perform an HTTP request with a hard timeout. Network-level failures throw a
 * {@link ConnectorDeliveryError} so callers don't have to re-classify them.
 * HTTP responses (including 4xx/5xx) are returned as-is for the caller to
 * interpret per provider semantics.
 */
export async function httpRequest(
  url: string,
  options: HttpRequestOptions = {},
): Promise<HttpResponse> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const init: RequestInit = {
      method: options.method ?? 'POST',
      signal: controller.signal,
      redirect: 'manual', // never follow; 3xx becomes a non-retryable failure via classifyHttpStatus
    };
    if (options.headers) init.headers = options.headers;
    if (options.body !== undefined) init.body = options.body;

    const res = await fetch(url, init);

    const body = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return { ok: res.ok, status: res.status, body, headers };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const category: FailureCategory = isAbort ? 'timeout' : 'network_error';
    throw new ConnectorDeliveryError(
      isAbort ? `Request timed out after ${timeoutMs}ms` : `Network error: ${(err as Error).message}`,
      category,
      true, // network/timeout failures are retryable
      { url: redactUrl(url) },
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Classify an HTTP status code into a retry decision + failure category.
 * - 2xx: success (callers handle separately)
 * - 408/429/5xx: retryable
 * - 401/403: auth error, not retryable
 * - other 4xx: invalid payload/config, not retryable
 */
export function classifyHttpStatus(status: number): {
  retryable: boolean;
  category: FailureCategory;
} {
  if (status >= 200 && status < 300) {
    return { retryable: false, category: 'unknown' };
  }
  if (status === 429) return { retryable: true, category: 'rate_limit' };
  if (status === 408 || status >= 500) return { retryable: true, category: 'network_error' };
  if (status === 401 || status === 403) return { retryable: false, category: 'auth_error' };
  return { retryable: false, category: 'invalid_payload' };
}

/** Strip query string + credentials from a URL for safe logging. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '[invalid-url]';
  }
}

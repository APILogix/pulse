import type { FastifyRequest } from "fastify";
/** Constant-time hex comparison that never short-circuits on length. */
export declare function constantTimeHexEqual(a: string, b: string): boolean;
export declare function sha256Hex(input: string): string;
export interface SignatureVerificationResult {
    valid: boolean;
    code?: string;
    message?: string;
}
/**
 * Verify request cryptographic signature and timestamp freshness.
 *
 * If `x-pulse-signature` or `x-pulse-timestamp` is provided:
 * 1. Checks that the timestamp is within ±5 minutes of server time to prevent replay attacks.
 * 2. Computes the canonical signature string: `${timestamp}:${method}:${path}:${bodyHash}`
 * 3. Verifies HMAC-SHA256 signature using constant-time comparison.
 *
 * If no signature headers are provided, returns `{ valid: true }` allowing fallback
 * to standard API key token authentication.
 */
export declare function verifyRequestSignature(rawKey: string, timestampHeader: string | undefined, signatureHeader: string | undefined, method: string, url: string, body: unknown, maxSkewMs?: number): SignatureVerificationResult;
/**
 * Protect server-to-server control-plane routes from unauthorized browser cross-origin requests.
 * If a request has Sec-Fetch-Mode: cors and an external Origin header, reject.
 */
export declare function checkBrowserOriginGuard(request: FastifyRequest): boolean;
/**
 * Check if the requested route path is permitted by the API key's allowed_endpoints restriction.
 * If allowedEndpoints is empty/null, all endpoints are allowed.
 */
export declare function isEndpointAllowed(requestedPath: string, allowedEndpoints?: string[] | null): boolean;
//# sourceMappingURL=security.d.ts.map
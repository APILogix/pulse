import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";

/** Constant-time hex comparison that never short-circuits on length. */
export function constantTimeHexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

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
export function verifyRequestSignature(
  rawKey: string,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
  method: string,
  url: string,
  body: unknown,
  maxSkewMs = 300_000, // 5 minutes
): SignatureVerificationResult {
  // If neither header is present, standard API key auth applies
  if (!signatureHeader && !timestampHeader) {
    return { valid: true };
  }

  // If one is present without the other, reject
  if (!signatureHeader || !timestampHeader) {
    return {
      valid: false,
      code: "missing_signature_headers",
      message: "Both x-pulse-timestamp and x-pulse-signature are required when signing requests",
    };
  }

  const timestamp = Number(timestampHeader);
  if (isNaN(timestamp) || timestamp <= 0) {
    return {
      valid: false,
      code: "invalid_timestamp",
      message: "x-pulse-timestamp must be a valid numeric unix timestamp in milliseconds",
    };
  }

  const now = Date.now();
  if (Math.abs(now - timestamp) > maxSkewMs) {
    return {
      valid: false,
      code: "timestamp_expired",
      message: "Request timestamp is expired or skewed beyond 5 minutes",
    };
  }

  const pathname = url.split("?")[0] || url;
  const bodyString = body && typeof body === "object"
    ? JSON.stringify(body)
    : (typeof body === "string" ? body : "{}");
  const bodyHash = sha256Hex(bodyString);
  const canonical = `${timestamp}:${method.toUpperCase()}:${pathname}:${bodyHash}`;

  const expectedSignature = createHmac("sha256", rawKey).update(canonical, "utf8").digest("hex");
  if (!constantTimeHexEqual(expectedSignature, signatureHeader.trim())) {
    return {
      valid: false,
      code: "invalid_signature",
      message: "HMAC signature verification failed",
    };
  }

  return { valid: true };
}

/**
 * Protect server-to-server control-plane routes from unauthorized browser cross-origin requests.
 * If a request has Sec-Fetch-Mode: cors and an external Origin header, reject.
 */
export function checkBrowserOriginGuard(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  const secFetchMode = request.headers["sec-fetch-mode"];
  if (secFetchMode === "cors" && origin) {
    return false;
  }
  return true;
}

/**
 * Check if the requested route path is permitted by the API key's allowed_endpoints restriction.
 * If allowedEndpoints is empty/null, all endpoints are allowed.
 */
export function isEndpointAllowed(requestedPath: string, allowedEndpoints?: string[] | null): boolean {
  if (!allowedEndpoints || allowedEndpoints.length === 0) return true;
  const normalized = (requestedPath.split("?")[0] || requestedPath).toLowerCase();
  for (const pattern of allowedEndpoints) {
    const p = pattern.trim().toLowerCase();
    if (p === "*" || p === normalized) return true;
    if ((normalized === "/init" && p === "/v1/init") || (normalized === "/v1/init" && p === "/init")) return true;
    if (p.endsWith("/*") && normalized.startsWith(p.slice(0, -2))) return true;
  }
  return false;
}

/**
 * Convert an IPv4 dotted-quad string into an unsigned 32-bit integer.
 * Returns null if the format is invalid.
 */
function ipv4ToNumber(ip) {
    const parts = ip.split(".");
    if (parts.length !== 4)
        return null;
    let num = 0;
    for (const part of parts) {
        const n = parseInt(part, 10);
        if (isNaN(n) || n < 0 || n > 255)
            return null;
        num = (num << 8) + n;
    }
    return num >>> 0;
}
/**
 * Check if an IP address satisfies a CIDR notation or exact match.
 * Supports IPv4 addresses, IPv4 CIDR blocks (e.g. 10.0.0.0/8, 192.168.1.0/24),
 * and exact IPv6 string matches.
 */
export function isIpInCidr(ip, cidr) {
    const cleanIp = ip.trim().toLowerCase();
    const cleanCidr = cidr.trim().toLowerCase();
    // If no prefix slash, perform exact match
    if (!cleanCidr.includes("/")) {
        return cleanIp === cleanCidr;
    }
    const [range, bitsStr] = cleanCidr.split("/");
    const bits = parseInt(bitsStr ?? "", 10);
    if (isNaN(bits) || bits < 0 || bits > 128)
        return false;
    // IPv4 CIDR match
    if (range && range.includes(".") && cleanIp.includes(".")) {
        const ipNum = ipv4ToNumber(cleanIp);
        const rangeNum = ipv4ToNumber(range);
        if (ipNum === null || rangeNum === null || bits > 32)
            return false;
        const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
        return (ipNum & mask) === (rangeNum & mask);
    }
    // Exact fallback
    return cleanIp === range;
}
/**
 * Check if the given client IP is allowed by the allowedIps list.
 * If allowedIps is null, undefined, or empty, access is unrestricted (true).
 * If populated, at least one CIDR/IP rule must match.
 */
export function isIpAllowed(clientIp, allowedIps) {
    if (!allowedIps || allowedIps.length === 0)
        return true;
    for (const entry of allowedIps) {
        if (entry && isIpInCidr(clientIp, entry)) {
            return true;
        }
    }
    return false;
}
/**
 * Extract trusted client IP from request, prioritizing standard proxy headers.
 */
export function extractClientIp(request) {
    const xForwardedFor = request.headers["x-forwarded-for"];
    if (typeof xForwardedFor === "string") {
        const first = xForwardedFor.split(",")[0]?.trim();
        if (first)
            return first;
    }
    const realIp = request.headers["x-real-ip"];
    if (typeof realIp === "string" && realIp.trim().length > 0) {
        return realIp.trim();
    }
    return request.ip || "127.0.0.1";
}
//# sourceMappingURL=ip-filter.js.map
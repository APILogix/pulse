import type { FastifyRequest } from "fastify";
/**
 * Check if an IP address satisfies a CIDR notation or exact match.
 * Supports IPv4 addresses, IPv4 CIDR blocks (e.g. 10.0.0.0/8, 192.168.1.0/24),
 * and exact IPv6 string matches.
 */
export declare function isIpInCidr(ip: string, cidr: string): boolean;
/**
 * Check if the given client IP is allowed by the allowedIps list.
 * If allowedIps is null, undefined, or empty, access is unrestricted (true).
 * If populated, at least one CIDR/IP rule must match.
 */
export declare function isIpAllowed(clientIp: string, allowedIps?: string[] | null): boolean;
/**
 * Extract trusted client IP from request, prioritizing standard proxy headers.
 */
export declare function extractClientIp(request: FastifyRequest): string;
//# sourceMappingURL=ip-filter.d.ts.map
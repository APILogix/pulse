/**
 * Per-request client metadata helpers.
 *
 * Trust model for the IP:
 *   - Fastify's `request.ip` is the only trusted source. App.ts configures
 *     `trustProxy` so the framework already walks `X-Forwarded-For` correctly
 *     and produces the IP of the closest *trusted* proxy or the client.
 *   - We INTENTIONALLY do not re-read `X-Forwarded-For`, `X-Real-IP`, or
 *     `CF-Connecting-IP` here. Re-reading those headers in application code
 *     bypasses Fastify's trust-proxy chain and lets any client spoof their
 *     own IP, which would break IP-based rate limiting, audit, security
 *     events, and `users.last_login_ip`.
 *
 * If you ever need a tighter model, narrow `trustProxy` to a specific
 * subnet in `app.ts` rather than re-implementing the chain here.
 */
import type { FastifyRequest } from 'fastify';
declare module 'fastify' {
    interface FastifyRequest {
        routerPath?: string;
        statusCode?: number;
        clientInfo: ClientInfo;
    }
}
export interface ClientInfo {
    ip: string;
    userAgent: string;
    device: DeviceInfo;
    requestId: string;
    timestamp: string;
    isMobile: boolean;
    isBot: boolean;
}
export interface DeviceInfo {
    type: 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown';
    browser: string;
    browserVersion: string;
    os: string;
    osVersion: string;
}
export interface RequestWithUser extends FastifyRequest {
    user: {
        id: string;
        email: string;
        isAdmin: boolean;
        sessionId: string;
        mfaVerified: boolean;
        stepUpFresh: boolean;
    };
    clientInfo: ClientInfo;
    startTime: number;
}
export declare function getClientInfo(request: FastifyRequest): ClientInfo;
export declare function buildSessionDeviceLabel(userAgent: string, fallbackType?: string | null): string;
export declare const clientInfoPlugin: (fastify: import("fastify").FastifyInstance<import("fastify").RawServerDefault, import("node:http").IncomingMessage, import("node:http").ServerResponse<import("node:http").IncomingMessage>, import("fastify").FastifyBaseLogger, import("fastify").FastifyTypeProviderDefault>) => Promise<void>;
//# sourceMappingURL=request.d.ts.map
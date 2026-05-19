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
    location: LocationInfo;
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
export interface LocationInfo {
    country?: string;
    region?: string;
    city?: string;
    timezone?: string;
    latitude?: number;
    longitude?: number;
}
export interface RequestWithUser extends FastifyRequest {
    user: {
        id: string;
        email: string;
        isAdmin: boolean;
        sessionId: string;
        mfaVerified: boolean;
    };
    clientInfo: ClientInfo;
    startTime: number;
}
export declare function getClientInfo(request: FastifyRequest): ClientInfo;
export declare function enrichLocationInfo(clientInfo: ClientInfo): Promise<ClientInfo>;
export declare function isSuspiciousRequest(clientInfo: ClientInfo, userContext?: RequestWithUser['user']): boolean;
export declare function generateRequestFingerprint(clientInfo: ClientInfo): string;
export declare function formatRequestLog(request: FastifyRequest, clientInfo: ClientInfo, durationMs: number): object;
export declare const clientInfoPlugin: (fastify: import("fastify").FastifyInstance<import("fastify").RawServerDefault, import("node:http").IncomingMessage, import("node:http").ServerResponse<import("node:http").IncomingMessage>, import("fastify").FastifyBaseLogger, import("fastify").FastifyTypeProviderDefault>) => Promise<void>;
//# sourceMappingURL=request.d.ts.map
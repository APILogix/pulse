import { type MFADevice, type SessionInfo, type User } from '../../domain/types.js';
export interface IssuedSession {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    sessionId: string;
}
/**
 * Single-INSERT session creation. We pre-allocate the session UUID and sign
 * both JWTs with it before writing any row, so there is no placeholder hash
 * window. The refresh JWT is hashed and persisted in the same INSERT.
 */
export interface SessionSsoContext {
    providerId?: string;
    providerType?: string;
    loginMethod?: string;
    samlNameId?: string;
    samlSessionIndex?: string;
}
export declare function issueSessionForUser(options: {
    user: User;
    ipAddress: string;
    userAgent: string;
    deviceName: string | undefined;
    deviceType: string | undefined;
    mfaVerified: boolean;
    rememberMe?: boolean;
    ssoContext?: SessionSsoContext;
}): Promise<IssuedSession>;
export declare function createLoginMFAChallenge(options: {
    userId: string;
    device: MFADevice;
    ipAddress: string;
    userAgent: string;
    deviceName: string | undefined;
    clientDeviceType: string | undefined;
    rememberMe: boolean;
    trustDevice: boolean;
    availableMethods?: Array<{
        id: string;
        type: string;
        name: string;
    }>;
}): {
    challengeId: string;
    expiresAt: Date;
    deviceType: string;
};
export declare function listUserSessions(userId: string, currentSessionId?: string): Promise<SessionInfo[]>;
export declare function revokeSession(userId: string, sessionId: string, currentSessionId?: string): Promise<void>;
/**
 * Revoke every session except the caller's. Surgically blacklists the
 * access tokens of OTHER sessions only — the caller's current access token
 * remains valid until it expires naturally.
 */
export declare function revokeAllOtherSessions(userId: string, currentSessionId: string): Promise<number>;
/**
 * Refresh-token rotation with reuse detection AND a 30-second retry-grace
 * window. The grace window is what protects legitimate clients on flaky
 * networks from being kicked out: when the same refresh token is presented
 * twice within the window, the second call is treated as a network retry,
 * not a replay attack.
 */
export declare function refreshAccessToken(refreshToken: string, ipAddress: string, userAgent: string, requestId: string): Promise<{
    accessToken: string;
    refreshToken: string;
    /** True only when this request produced a replacement refresh token. */
    refreshTokenRotated: boolean;
    expiresAt: Date;
    sessionId: string;
    userId: string;
    currentOrgId: string | null;
}>;
export declare function logout(userId: string, sessionId: string, ipAddress: string, requestId: string): Promise<{
    saml_logout_url: string | null;
}>;
export declare function getUserSessionDetail(userId: string, sessionId: string, currentSessionId: string): Promise<{
    id: string;
    device_name: string;
    device_type: string;
    ip_address: string;
    ip_geo_country: string | null;
    last_active_at: Date;
    created_at: Date;
    expires_at: Date;
    login_method: string | null;
    is_current: boolean;
}>;
export declare function revokeAllSessionsForUser(userId: string): Promise<number>;
//# sourceMappingURL=session.service.d.ts.map
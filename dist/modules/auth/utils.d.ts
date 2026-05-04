export declare const ACCESS_TOKEN_TTL_SECONDS: number;
export declare const REFRESH_TOKEN_TTL_SECONDS: number;
export declare const ABSOLUTE_SESSION_TTL_SECONDS: number;
export declare const MFA_LOGIN_CHALLENGE_TTL_SECONDS: number;
export declare const PASSWORD_RESET_TTL_SECONDS: number;
export declare function hashToken(token: string): string;
export declare function generateSecureToken(byteLength?: number): string;
export declare function generateAccessToken(userId: string, sessionId: string, mfaVerified: boolean): string;
export declare function generateRefreshToken(userId: string, sessionId: string): string;
export declare function getRefreshCookieOptions(): {
    httpOnly: boolean;
    secure: boolean;
    sameSite: "strict";
    maxAge: number;
    path: string;
};
export declare function normalizeEmail(email: string): string;
export declare function buildPasswordHistory(currentHistory: unknown, currentPasswordHash: string | null): string[];
//# sourceMappingURL=utils.d.ts.map
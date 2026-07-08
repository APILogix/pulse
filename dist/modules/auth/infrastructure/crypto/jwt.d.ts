export interface AccessTokenClaims {
    sub: string;
    jti: string;
    mfa_verified: boolean;
    type: 'access';
    iss: string;
    aud: string;
    iat: number;
    exp: number;
}
export interface RefreshTokenClaims {
    sub: string;
    jti: string;
    type: 'refresh';
    iss: string;
    aud: string;
    iat: number;
    exp: number;
}
export declare function generateAccessToken(userId: string, sessionId: string, mfaVerified: boolean): string;
export declare function generateRefreshToken(userId: string, sessionId: string, expiresInSeconds?: number): string;
export declare function verifyAccessToken(token: string): AccessTokenClaims;
export declare function verifyRefreshToken(token: string): RefreshTokenClaims;
//# sourceMappingURL=jwt.d.ts.map
import jwt from 'jsonwebtoken';
import { env } from '../../../../config/env.js';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from '../../domain/constants.js';
const JWT_ISSUER = 'pulsiv';
const JWT_AUDIENCE = 'pulsiv';
export function generateAccessToken(userId, sessionId, mfaVerified) {
    return jwt.sign({ sub: userId, jti: sessionId, mfa_verified: mfaVerified, type: 'access' }, env.JWT_SECRET, {
        expiresIn: ACCESS_TOKEN_TTL_SECONDS, algorithm: 'HS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE,
    });
}
export function generateRefreshToken(userId, sessionId, expiresInSeconds = REFRESH_TOKEN_TTL_SECONDS) {
    return jwt.sign({ sub: userId, jti: sessionId, type: 'refresh' }, env.JWT_REFRESH_SECRET, {
        expiresIn: expiresInSeconds, algorithm: 'HS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE,
    });
}
export function verifyAccessToken(token) {
    return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
}
export function verifyRefreshToken(token) {
    return jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
}
//# sourceMappingURL=jwt.js.map
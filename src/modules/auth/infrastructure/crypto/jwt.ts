import jwt from 'jsonwebtoken';
import { env } from '../../../../config/env.js';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from '../../domain/constants.js';

const JWT_ISSUER = 'pulsiv';
const JWT_AUDIENCE = 'pulsiv';

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
export function generateAccessToken(userId: string, sessionId: string, mfaVerified: boolean): string {
  return jwt.sign({ sub: userId, jti: sessionId, mfa_verified: mfaVerified, type: 'access' }, env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL_SECONDS, algorithm: 'HS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE,
  });
}
export function generateRefreshToken(userId: string, sessionId: string, expiresInSeconds: number = REFRESH_TOKEN_TTL_SECONDS): string {
  return jwt.sign({ sub: userId, jti: sessionId, type: 'refresh' }, env.JWT_REFRESH_SECRET, {
    expiresIn: expiresInSeconds, algorithm: 'HS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE,
  });
}
export function verifyAccessToken(token: string): AccessTokenClaims {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE }) as AccessTokenClaims;
}
export function verifyRefreshToken(token: string): RefreshTokenClaims {
  return jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE }) as RefreshTokenClaims;
}

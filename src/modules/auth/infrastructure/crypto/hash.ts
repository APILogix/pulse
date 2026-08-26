import { createHash, randomBytes, createHmac } from 'crypto';
import bcrypt from 'bcrypt';
import type { EmailFlowPurpose } from '../../domain/constants.js';
import { env } from '../../../../config/env.js';

/** Constant-time HMAC-SHA256 for sensitive bearer tokens.
 *  Uses a server-side secret so rainbow-table / offline brute-force of
 *  short tokens (e.g. 6-digit OTPs) is infeasible. */
export function hashToken(token: string): string {
  return createHmac('sha256', env.AUTH_TOKEN_SECRET)
    .update(token)
    .digest('hex');
}

export function generateSecureToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('hex');
}

export function hashEmailFlowToken(purpose: EmailFlowPurpose, token: string): string {
  return hashToken(`${purpose}:${token}`);
}

export function generateEmailFlowToken(): string {
  return generateSecureToken(48); // EMAIL_FLOW_TOKEN_BYTES
}

export const FAKE_BCRYPT_HASH = bcrypt.hashSync(generateSecureToken(16), 12);
export async function timingSafeFakePasswordCompare(candidate: string): Promise<void> {
  await bcrypt.compare(candidate, FAKE_BCRYPT_HASH);
}

export function buildDeviceFingerprint(ip: string, userAgent: string): string {
  return createHash('sha256').update(`${ip}:${userAgent}`).digest('hex').substring(0, 32);
}

export function getIpSubnet(ip: string): string {
  if (!ip || ip === 'unknown') return 'unknown';
  if (ip.includes('.')) {
    // IPv4: match /24 prefix (first 3 octets)
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}`;
    }
  } else if (ip.includes(':')) {
    // IPv6: match /48 prefix (first 3 segments)
    const parts = ip.split(':');
    if (parts.length >= 3) {
      return `${parts[0]}:${parts[1]}:${parts[2]}`;
    }
  }
  return ip;
}

export function validateSessionDevice(
  sessionFingerprint: string | null | undefined,
  sessionUa: string | null | undefined,
  sessionIp: string | null | undefined,
  currentIp: string,
  currentUa: string,
): boolean {
  if (!sessionFingerprint) return true;
  const currentFingerprint = buildDeviceFingerprint(currentIp, currentUa);
  if (sessionFingerprint === currentFingerprint) return true;

  // Mobile / CGNAT IP churn resilience:
  // If User-Agent is identical and the IP is in the same /24 or /48 subnet (or matching user agent),
  // allow legitimate network transitions without triggering false-positive session revocations.
  if (sessionUa && sessionUa === currentUa) {
    if (!sessionIp || sessionIp === currentIp) return true;
    if (getIpSubnet(sessionIp) === getIpSubnet(currentIp)) return true;
  }

  return false;
}


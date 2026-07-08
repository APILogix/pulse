import { createHash, randomBytes, createHmac } from 'crypto';
import bcrypt from 'bcrypt';
import { env } from '../../../../config/env.js';
/** Constant-time HMAC-SHA256 for sensitive bearer tokens.
 *  Uses a server-side secret so rainbow-table / offline brute-force of
 *  short tokens (e.g. 6-digit OTPs) is infeasible. */
export function hashToken(token) {
    return createHmac('sha256', env.AUTH_TOKEN_SECRET)
        .update(token)
        .digest('hex');
}
export function generateSecureToken(byteLength = 32) {
    return randomBytes(byteLength).toString('hex');
}
export function hashEmailFlowToken(purpose, token) {
    return hashToken(`${purpose}:${token}`);
}
export function generateEmailFlowToken() {
    return generateSecureToken(48); // EMAIL_FLOW_TOKEN_BYTES
}
export const FAKE_BCRYPT_HASH = bcrypt.hashSync(generateSecureToken(16), 12);
export async function timingSafeFakePasswordCompare(candidate) {
    await bcrypt.compare(candidate, FAKE_BCRYPT_HASH);
}
export function buildDeviceFingerprint(ip, userAgent) {
    return createHash('sha256').update(`${ip}:${userAgent}`).digest('hex').substring(0, 32);
}
//# sourceMappingURL=hash.js.map
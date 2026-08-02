import type { EmailFlowPurpose } from '../../domain/constants.js';
/** Constant-time HMAC-SHA256 for sensitive bearer tokens.
 *  Uses a server-side secret so rainbow-table / offline brute-force of
 *  short tokens (e.g. 6-digit OTPs) is infeasible. */
export declare function hashToken(token: string): string;
export declare function generateSecureToken(byteLength?: number): string;
export declare function hashEmailFlowToken(purpose: EmailFlowPurpose, token: string): string;
export declare function generateEmailFlowToken(): string;
export declare const FAKE_BCRYPT_HASH: string;
export declare function timingSafeFakePasswordCompare(candidate: string): Promise<void>;
export declare function buildDeviceFingerprint(ip: string, userAgent: string): string;
//# sourceMappingURL=hash.d.ts.map
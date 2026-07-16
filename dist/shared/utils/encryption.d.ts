/**
 * Encrypt a UTF-8 string using AES-256-GCM with a per-record random scrypt
 * salt and IV.
 */
export declare function encrypt(plaintext: string, secret: string): string;
/**
 * Decrypt a string produced by `encrypt`. Throws on tamper detection or
 * format mismatch. Callers should treat any thrown error as data corruption
 * or a key-mismatch and refuse to proceed.
 *
 * Backward compatibility: also accepts the legacy 3-segment format
 * (iv:authTag:ciphertext) using a hardcoded salt, so MFA secrets encrypted
 * with the older code keep working until they are rotated.
 */
export declare function decrypt(payload: string, secret: string): string;
export declare function decryptAsync(payload: string, secret: string): Promise<string>;
/**
 * Hash a user password using bcrypt with the production cost factor.
 */
export declare function hashPassword(password: string): Promise<string>;
/**
 * Verify a candidate password against a stored bcrypt hash. Constant-time
 * within bcrypt's own implementation.
 */
export declare function verifyPassword(password: string, hash: string): Promise<boolean>;
//# sourceMappingURL=encryption.d.ts.map
/**
 * Encrypt text using AES-256-GCM
 */
export declare function encrypt(text: string, secret: string): string;
/**
 * Decrypt text using AES-256-GCM
 */
export declare function decrypt(encryptedData: string, secret: string): string;
/**
 * Hash password using bcrypt-like approach (use bcrypt library in production)
 */
export declare function hashPassword(password: string): Promise<string>;
export declare function verifyPassword(password: string, hash: string): Promise<boolean>;
//# sourceMappingURL=encryption.d.ts.map
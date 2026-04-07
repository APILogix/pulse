import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
/**
 * Derive key from secret using scrypt
 */
function deriveKey(secret) {
    return scryptSync(secret, 'salt', KEY_LENGTH);
}
/**
 * Encrypt text using AES-256-GCM
 */
export function encrypt(text, secret) {
    const iv = randomBytes(IV_LENGTH);
    const key = deriveKey(secret);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    // Format: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}
/**
 * Decrypt text using AES-256-GCM
 */
export function decrypt(encryptedData, secret) {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted format');
    }
    // Explicit destructuring AFTER validation
    const ivHex = parts[0];
    const authTagHex = parts[1];
    const encrypted = parts[2];
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const key = deriveKey(secret);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}
/**
 * Hash password using bcrypt-like approach (use bcrypt library in production)
 */
export async function hashPassword(password) {
    // Use bcrypt in production: import bcrypt from 'bcrypt'; return bcrypt.hash(password, 12);
    const { hash } = await import('bcrypt');
    return hash(password, 12);
}
export async function verifyPassword(password, hash) {
    const { compare } = await import('bcrypt');
    return compare(password, hash);
}
//# sourceMappingURL=encryption.js.map
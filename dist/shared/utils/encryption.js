/**
 * Cryptographic primitives used across the auth module.
 *
 * Encryption (AES-256-GCM with per-record scrypt salt):
 *   - Each ciphertext bundles a fresh random salt so an attacker who learns
 *     the master key cannot precompute a rainbow table for derived keys.
 *   - GCM authenticates the ciphertext to detect tampering.
 *
 * Format: salt:iv:authTag:ciphertext (all hex-encoded).
 *
 * Password hashing (bcrypt cost 12):
 *   - bcrypt cost 12 (~150-300ms per hash) follows OWASP 2024 guidance.
 *     Lowering it to "speed up logins" is a false economy because login
 *     latency is dominated by network round-trips, not bcrypt; the same
 *     change makes offline cracking 16x faster after a DB compromise.
 */
import crypto, { createCipheriv, createDecipheriv, randomBytes, scryptSync, } from 'crypto';
import bcrypt from 'bcrypt';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard; 96-bit IV
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const BCRYPT_COST = 12;
function deriveKey(secret, salt) {
    // scrypt parameters: N=2^14 keeps key derivation under ~50ms per call which
    // is acceptable for MFA secret encryption that runs once per device write.
    return scryptSync(secret, salt, KEY_LENGTH, { N: 16384, r: 8, p: 1 });
}
let KEY_CACHE_MAX = 500;
/** saltHex → derived key promise. Map preserves insertion order → LRU via delete+set. */
const derivedKeyCache = new Map();
async function deriveKeyAsync(secret, salt, saltHex) {
    const hit = derivedKeyCache.get(saltHex);
    if (hit) {
        derivedKeyCache.delete(saltHex);
        derivedKeyCache.set(saltHex, hit); // refresh recency
        return hit;
    }
    const keyPromise = new Promise((resolve, reject) => {
        crypto.scrypt(secret, salt, KEY_LENGTH, { N: 16384, r: 8, p: 1 }, (err, k) => err ? reject(err) : resolve(k));
    });
    if (derivedKeyCache.size >= KEY_CACHE_MAX) {
        derivedKeyCache.delete(derivedKeyCache.keys().next().value); // evict oldest
    }
    derivedKeyCache.set(saltHex, keyPromise);
    return keyPromise;
}
export const _testEncryptionCache = {
    get size() { return derivedKeyCache.size; },
    clear() { derivedKeyCache.clear(); },
    setMax(max) { KEY_CACHE_MAX = max; }
};
/**
 * Encrypt a UTF-8 string using AES-256-GCM with a per-record random scrypt
 * salt and IV.
 */
export function encrypt(plaintext, secret) {
    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const key = deriveKey(secret, salt);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
        salt.toString('hex'),
        iv.toString('hex'),
        authTag.toString('hex'),
        ciphertext.toString('hex'),
    ].join(':');
}
/**
 * Decrypt a string produced by `encrypt`. Throws on tamper detection or
 * format mismatch. Callers should treat any thrown error as data corruption
 * or a key-mismatch and refuse to proceed.
 *
 * Backward compatibility: also accepts the legacy 3-segment format
 * (iv:authTag:ciphertext) using a hardcoded salt, so MFA secrets encrypted
 * with the older code keep working until they are rotated.
 */
export function decrypt(payload, secret) {
    const parts = payload.split(':');
    if (parts.length === 4) {
        const [saltHex, ivHex, authTagHex, ciphertextHex] = parts;
        const salt = Buffer.from(saltHex, 'hex');
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const ciphertext = Buffer.from(ciphertextHex, 'hex');
        const key = deriveKey(secret, salt);
        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        const plaintext = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final(),
        ]);
        return plaintext.toString('utf8');
    }
    if (parts.length === 3) {
        // Legacy format with hardcoded scrypt salt 'salt' and 16-byte IV.
        const [ivHex, authTagHex, ciphertextHex] = parts;
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const ciphertext = Buffer.from(ciphertextHex, 'hex');
        const legacyKey = scryptSync(secret, 'salt', KEY_LENGTH);
        const decipher = createDecipheriv(ALGORITHM, legacyKey, iv);
        decipher.setAuthTag(authTag);
        const plaintext = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final(),
        ]);
        return plaintext.toString('utf8');
    }
    throw new Error('Invalid encrypted payload format');
}
export async function decryptAsync(payload, secret) {
    const parts = payload.split(':');
    if (parts.length === 4) {
        const [saltHex, ivHex, authTagHex, ciphertextHex] = parts;
        const salt = Buffer.from(saltHex, 'hex');
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const ciphertext = Buffer.from(ciphertextHex, 'hex');
        const key = await deriveKeyAsync(secret, salt, saltHex);
        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        const plaintext = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final(),
        ]);
        return plaintext.toString('utf8');
    }
    if (parts.length === 3) {
        // Legacy format with hardcoded scrypt salt 'salt' and 16-byte IV.
        const [ivHex, authTagHex, ciphertextHex] = parts;
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const ciphertext = Buffer.from(ciphertextHex, 'hex');
        const legacyKey = await new Promise((resolve, reject) => {
            crypto.scrypt(secret, 'salt', KEY_LENGTH, (err, derivedKey) => {
                if (err)
                    reject(err);
                else
                    resolve(derivedKey);
            });
        });
        const decipher = createDecipheriv(ALGORITHM, legacyKey, iv);
        decipher.setAuthTag(authTag);
        const plaintext = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final(),
        ]);
        return plaintext.toString('utf8');
    }
    throw new Error('Invalid encrypted payload format');
}
/**
 * Hash a user password using bcrypt with the production cost factor.
 */
export async function hashPassword(password) {
    return bcrypt.hash(password, BCRYPT_COST);
}
/**
 * Verify a candidate password against a stored bcrypt hash. Constant-time
 * within bcrypt's own implementation.
 */
export async function verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
}
//# sourceMappingURL=encryption.js.map
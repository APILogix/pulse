/**
 * Connector credential encryption service.
 *
 * Wraps the shared AES-256-GCM primitive (shared/utils/encryption.ts) with a
 * connector-specific concern: serializing a config object to JSON, encrypting
 * it, and storing the ciphertext as Postgres `bytea`.
 *
 * Storage format:
 *   - The shared `encrypt()` returns a colon-joined hex string
 *     (salt:iv:authTag:ciphertext). We persist that UTF-8 string directly as
 *     the bytes of a `bytea` column so the column is self-describing and the
 *     legacy/forward-compat decrypt logic continues to apply.
 *
 * Key rotation:
 *   - `reencrypt()` decrypts with the current key and re-encrypts, producing a
 *     fresh per-record salt + IV. Because each ciphertext is independent,
 *     rotating a secret value is a localized operation.
 */
import { encrypt, decrypt } from '../../shared/utils/encryption.js';
import { env } from '../../config/env.js';
import type { ConnectorConfig } from './types.js';

const SECRET = env.ENCRYPTION_KEY;

/** Encrypt a connector config object to a `bytea`-ready Buffer. */
export function encryptConfig(config: ConnectorConfig): Buffer {
  const json = JSON.stringify(config ?? {});
  const ciphertext = encrypt(json, SECRET);
  return Buffer.from(ciphertext, 'utf8');
}

/** Decrypt a `bytea` config blob back into the original object. */
export function decryptConfig(blob: Buffer): ConnectorConfig {
  const ciphertext = blob.toString('utf8');
  const json = decrypt(ciphertext, SECRET);
  return JSON.parse(json) as ConnectorConfig;
}

/** Encrypt an arbitrary secret string (OAuth tokens, signing secrets). */
export function encryptSecret(value: string): Buffer {
  return Buffer.from(encrypt(value, SECRET), 'utf8');
}

/** Decrypt a secret string previously stored with {@link encryptSecret}. */
export function decryptSecret(blob: Buffer): string {
  return decrypt(blob.toString('utf8'), SECRET);
}

/**
 * Re-encrypt a config blob (key/salt rotation). Returns a new Buffer with a
 * fresh salt + IV. Safe to call repeatedly; it never changes the plaintext.
 */
export function reencryptConfig(blob: Buffer): Buffer {
  const config = decryptConfig(blob);
  return encryptConfig(config);
}

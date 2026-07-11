import type { ConnectorConfig } from '../types.js';
/** Encrypt a connector config object to a `bytea`-ready Buffer. */
export declare function encryptConfig(config: ConnectorConfig): Buffer;
/** Decrypt a `bytea` config blob back into the original object. */
export declare function decryptConfig(blob: Buffer): ConnectorConfig;
/** Encrypt an arbitrary secret string (OAuth tokens, signing secrets). */
export declare function encryptSecret(value: string): Buffer;
/** Decrypt a secret string previously stored with {@link encryptSecret}. */
export declare function decryptSecret(blob: Buffer): string;
/**
 * Re-encrypt a config blob (key/salt rotation). Returns a new Buffer with a
 * fresh salt + IV. Safe to call repeatedly; it never changes the plaintext.
 */
export declare function reencryptConfig(blob: Buffer): Buffer;
//# sourceMappingURL=secret.service.d.ts.map
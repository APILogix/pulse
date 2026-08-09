/**
 * Shared Public ID Generator & Utility.
 *
 * Provides deterministic formatting, validation, and prefix mapping for
 * human-readable Public IDs across all user-facing observability entities.
 * Format: PREFIX-000000000 (e.g. REQ-000000001, ERR-000000001).
 */

export const PUBLIC_ID_PREFIXES = {
  requests: 'REQ',
  errors: 'ERR',
  errorGroups: 'ISS',
  traces: 'TRC',
  spans: 'SPN',
  logs: 'LOG',
  messages: 'MSG',
  sessions: 'SES',
  replays: 'RPL',
  profiles: 'PRF',
  cronCheckins: 'CRN',
} as const;

export type PublicIdEntity = keyof typeof PUBLIC_ID_PREFIXES;
export type PublicIdPrefix = (typeof PUBLIC_ID_PREFIXES)[PublicIdEntity];

const PUBLIC_ID_REGEX = /^(REQ|ERR|ISS|TRC|SPN|LOG|MSG|SES|RPL|PRF|CRN)-\d{1,12}$/i;

/** Format a sequence or integer ID into a canonical Public ID string. */
export function formatPublicId(prefix: PublicIdPrefix, num: number | bigint | string): string {
  const n = String(num).padStart(9, '0');
  return `${prefix}-${n}`;
}

/** Returns true if the string is a valid Public ID format (e.g. REQ-000000001). */
export function isPublicId(value: unknown): value is string {
  return typeof value === 'string' && PUBLIC_ID_REGEX.test(value.trim());
}

/** Extract the entity prefix from a Public ID string. */
export function extractPublicIdPrefix(publicId: string): PublicIdPrefix | null {
  if (!isPublicId(publicId)) return null;
  const prefix = publicId.split('-')[0]?.toUpperCase();
  return (prefix as PublicIdPrefix) ?? null;
}

/**
 * Organization utility functions.
 *
 * Flow:
 * - Token and hash helpers support invitation security.
 * - Slug generation creates stable URL-safe organization identifiers.
 * - Billing address sanitization protects repository code from malformed JSON.
 * - Logger factory gives module-scoped diagnostics without coupling services to
 *   a concrete logging implementation.
 */
import { createHash, randomBytes } from 'crypto';
import type { BillingAddress } from './types.js';
import { BillingAddressSchema } from './types.js';

export function generateInvitationToken(): string {
  // Invitation tokens are high-entropy plaintext values returned once; the
  // repository stores only their hash.
  return randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);

  return base || `org-${randomBytes(3).toString('hex')}`;
}

export function sanitizeBillingAddress(value: unknown): BillingAddress | null {
  // Use the shared schema to reject malformed billing contact data instead of
  // trusting JSON stored in billing notes.
  const parsed = BillingAddressSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

export function createOrganizationLogger(context: string) {
  return {
    info: (message: string, meta?: any) => {
      console.log(`[ORGANIZATION:${context}] ${message}`, meta ? JSON.stringify(meta) : '');
    },
    error: (message: string, error?: any) => {
      console.error(`[ORGANIZATION:${context}:ERROR] ${message}`, error);
    },
    warn: (message: string, meta?: any) => {
      console.warn(`[ORGANIZATION:${context}:WARN] ${message}`, meta ? JSON.stringify(meta) : '');
    },
    debug: (message: string, meta?: any) => {
      if (process.env.DEBUG_BILLING === 'true') {
        console.log(`[ORGANIZATION:${context}:DEBUG] ${message}`, meta ? JSON.stringify(meta) : '');
      }
    }
  };
}

export { checkSsrf, validateWebhookUrl, type ValidateUrlOptions } from '../../shared/utils/ssrf.js';

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK ALLOWLIST VERIFIER (server-side)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Server-side allowlist verifier interface.
 * Only URLs verified by this interface skip approval requirements.
 * Mere HTTPS status or user-supplied metadata does NOT constitute allowlisting.
 */
export interface WebhookAllowlistVerifier {
  /** 
   * Check if a URL is on the server-side allowlist for this organization.
   * This must be a stored, admin-configured list—NOT inferred from user input.
   */
  isAllowed(orgId: string, url: string): Promise<boolean>;
}

/**
 * Default verifier: nothing is allowlisted. All webhook.call actions require approval.
 * Override this with a real implementation that reads from org_webhook_allowlist table.
 */
export class DefaultWebhookAllowlistVerifier implements WebhookAllowlistVerifier {
  async isAllowed(_orgId: string, _url: string): Promise<boolean> {
    // Default: no URL is allowlisted. All require approval.
    return false;
  }
}

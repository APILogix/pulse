/**
 * Automation module – SSRF protection & webhook URL allowlist verifier.
 *
 * Blocks: private/loopback/link-local IPs, credentials in URLs,
 * non-HTTPS protocols, and DNS rebind-susceptible hosts.
 * Provides a server-side allowlist verification interface.
 */
/**
 * Check if a hostname/IP is a blocked private/loopback/link-local address.
 * Returns a reason string if blocked, null if safe.
 */
export declare function checkSsrf(hostname: string): string | null;
/**
 * Validate a URL for safe outbound webhook delivery.
 * Returns { safe: true } or { safe: false, reason: string }.
 */
export declare function validateWebhookUrl(url: string): {
    safe: boolean;
    reason?: string;
};
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
export declare class DefaultWebhookAllowlistVerifier implements WebhookAllowlistVerifier {
    isAllowed(_orgId: string, _url: string): Promise<boolean>;
}
//# sourceMappingURL=ssrf.d.ts.map
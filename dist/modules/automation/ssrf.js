export { checkSsrf, validateWebhookUrl } from '../../shared/utils/ssrf.js';
/**
 * Default verifier: nothing is allowlisted. All webhook.call actions require approval.
 * Override this with a real implementation that reads from org_webhook_allowlist table.
 */
export class DefaultWebhookAllowlistVerifier {
    async isAllowed(_orgId, _url) {
        // Default: no URL is allowlisted. All require approval.
        return false;
    }
}
//# sourceMappingURL=ssrf.js.map
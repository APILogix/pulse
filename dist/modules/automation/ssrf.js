/**
 * Automation module – SSRF protection & webhook URL allowlist verifier.
 *
 * Blocks: private/loopback/link-local IPs, credentials in URLs,
 * non-HTTPS protocols, and DNS rebind-susceptible hosts.
 * Provides a server-side allowlist verification interface.
 */
import { URL } from 'url';
import * as net from 'net';
// ═══════════════════════════════════════════════════════════════════════════════
// SSRF BLOCKED RANGES (private, loopback, link-local, reserved)
// ═══════════════════════════════════════════════════════════════════════════════
const BLOCKED_IPV4_RANGES = [
    { prefix: '10.', label: 'private (10.0.0.0/8)' },
    { prefix: '127.', label: 'loopback (127.0.0.0/8)' },
    { prefix: '169.254.', label: 'link-local (169.254.0.0/16)' },
    { prefix: '172.16.', label: 'private (172.16.0.0/12)' },
    { prefix: '172.17.', label: 'private (172.16.0.0/12)' },
    { prefix: '172.18.', label: 'private (172.16.0.0/12)' },
    { prefix: '172.19.', label: 'private (172.16.0.0/12)' },
    { prefix: '172.20.', label: 'private (172.16.0.0/12)' },
    { prefix: '172.21.', label: 'private (172.16.0.0/12)' },
    { prefix: '172.22.', label: 'private (172.16.0.0/12)' },
    { prefix: '172.23.', label: 'private (172.16.0.0/12)' },
    { prefix: '172.24.', label: 'private (172.16.0.0/12)' },
    { prefix: '172.25.', label: 'private (172.16.0.0/12)' },
    { prefix: '172.26.', label: 'private (172.16.0.0/12)' },
    { prefix: '172.27.', label: 'private (172.16.0.0/12)' },
    { prefix: '172.28.', label: 'private (172.16.0.0/12)' },
    { prefix: '172.29.', label: 'private (172.16.0.0/12)' },
    { prefix: '172.30.', label: 'private (172.16.0.0/12)' },
    { prefix: '172.31.', label: 'private (172.16.0.0/12)' },
    { prefix: '192.168.', label: 'private (192.168.0.0/16)' },
    { prefix: '0.', label: 'reserved (0.0.0.0/8)' },
    { prefix: '192.0.2.', label: 'documentation (192.0.2.0/24)' },
    { prefix: '198.51.100.', label: 'documentation (198.51.100.0/24)' },
    { prefix: '203.0.113.', label: 'documentation (203.0.113.0/24)' },
    { prefix: '100.64.', label: 'shared address (100.64.0.0/10)' },
];
const BLOCKED_IPV6_PREFIXES = [
    '::1', // loopback
    'fe80:', // link-local
    'fc00:', // unique local
    'fd', // unique local
    '::ffff:127.', // IPv4-mapped loopback
    '::ffff:10.', // IPv4-mapped private
    '::ffff:192.168.', // IPv4-mapped private
    '::ffff:172.16.', // IPv4-mapped private
];
const BLOCKED_HOSTNAMES = new Set([
    'localhost',
    'localhost.localdomain',
    'ip6-localhost',
    'ip6-loopback',
    'metadata.google.internal', // GCP metadata
    '169.254.169.254', // AWS/GCP/Azure metadata
    'metadata.google.internal.',
]);
/**
 * Check if a hostname/IP is a blocked private/loopback/link-local address.
 * Returns a reason string if blocked, null if safe.
 */
export function checkSsrf(hostname) {
    const lower = hostname.toLowerCase().trim();
    // Direct hostname blocklist
    if (BLOCKED_HOSTNAMES.has(lower)) {
        return `Blocked hostname: ${lower}`;
    }
    // IPv4 checks
    if (net.isIPv4(lower)) {
        for (const range of BLOCKED_IPV4_RANGES) {
            if (lower.startsWith(range.prefix)) {
                return `Blocked IP range: ${range.label}`;
            }
        }
    }
    // IPv6 checks
    if (net.isIPv6(lower)) {
        const normalized = lower.toLowerCase();
        for (const prefix of BLOCKED_IPV6_PREFIXES) {
            if (normalized.startsWith(prefix)) {
                return `Blocked IPv6 range: ${prefix}`;
            }
        }
    }
    // Check for numeric IPs that bypass text prefix checks
    if (net.isIP(lower)) {
        // Already handled above
        return null;
    }
    // Block hosts that look like internal infrastructure
    if (lower.endsWith('.internal') || lower.endsWith('.local') || lower.endsWith('.localhost')) {
        return `Blocked internal hostname suffix: ${lower}`;
    }
    return null;
}
/**
 * Validate a URL for safe outbound webhook delivery.
 * Returns { safe: true } or { safe: false, reason: string }.
 */
export function validateWebhookUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        return { safe: false, reason: 'Invalid URL format' };
    }
    // Protocol must be HTTPS
    if (parsed.protocol !== 'https:') {
        return { safe: false, reason: `Protocol must be https, got ${parsed.protocol}` };
    }
    // No credentials in URL
    if (parsed.username || parsed.password) {
        return { safe: false, reason: 'URL must not contain credentials' };
    }
    // Hostname SSRF check
    const ssrfResult = checkSsrf(parsed.hostname);
    if (ssrfResult) {
        return { safe: false, reason: ssrfResult };
    }
    return { safe: true };
}
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
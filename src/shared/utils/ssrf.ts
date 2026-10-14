/**
 * Centralized SSRF Protection & Webhook URL Verifier.
 *
 * Blocks:
 *   - Private/loopback/link-local IPv4 & IPv6 addresses (RFC 1918, RFC 3927, RFC 4193).
 *   - Cloud instance metadata endpoints (169.254.169.254, metadata.google.internal).
 *   - Credentials in URLs (username:password@host).
 *   - Non-HTTP(S) protocols.
 *   - Internal hostnames and suffixes (.internal, .local, .localhost).
 */
import { URL } from 'url';
import * as net from 'net';
import * as dns from 'dns';

const BLOCKED_IPV4_RANGES = [
  { prefix: '10.', label: 'private (10.0.0.0/8)' },
  { prefix: '127.', label: 'loopback (127.0.0.0/8)' },
  { prefix: '169.254.', label: 'link-local / cloud metadata (169.254.0.0/16)' },
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
  '::1',          // loopback
  'fe80:',        // link-local
  'fc00:',        // unique local
  'fd',           // unique local
  '::ffff:127.',  // IPv4-mapped loopback
  '::ffff:10.',   // IPv4-mapped private
  '::ffff:192.168.', // IPv4-mapped private
  '::ffff:172.16.',  // IPv4-mapped private
  '::ffff:169.254.', // IPv4-mapped link-local
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata.google.internal.',
  '169.254.169.254',
  'instance-data',
]);

export function checkSsrf(hostname: string): string | null {
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

  // Block hosts that look like internal infrastructure
  if (lower.endsWith('.internal') || lower.endsWith('.local') || lower.endsWith('.localhost')) {
    return `Blocked internal hostname suffix: ${lower}`;
  }

  return null;
}

export interface ValidateUrlOptions {
  allowHttp?: boolean;
}

export function validateWebhookUrl(
  url: string,
  options: ValidateUrlOptions = {},
): { safe: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { safe: false, reason: 'Invalid URL format' };
  }

  const isDevOrTest = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
  const allowHttp = options.allowHttp ?? isDevOrTest;

  // Protocol must be HTTPS (or HTTP if explicitly permitted in dev/test)
  if (parsed.protocol !== 'https:' && (!allowHttp || parsed.protocol !== 'http:')) {
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
 * Asynchronously validates a webhook destination URL, resolving DNS records to
 * protect against DNS rebinding and internal subnet routing attacks.
 */
export async function validateWebhookUrlAsync(
  url: string,
  options: ValidateUrlOptions = {},
): Promise<{ safe: boolean; reason?: string }> {
  // 1. Static syntactical and lexical check
  const syncCheck = validateWebhookUrl(url, options);
  if (!syncCheck.safe) {
    return syncCheck;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { safe: false, reason: 'Invalid URL format' };
  }

  // If hostname is already a raw IP literal, sync check already validated it
  if (net.isIP(parsed.hostname)) {
    return { safe: true };
  }

  // 2. DNS resolution check (anti-rebinding / private network resolution)
  try {
    const addresses = await dns.promises.lookup(parsed.hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      return { safe: false, reason: `DNS resolution failed: no addresses found for ${parsed.hostname}` };
    }

    for (const record of addresses) {
      const ipCheck = checkSsrf(record.address);
      if (ipCheck) {
        return {
          safe: false,
          reason: `Resolved IP ${record.address} blocked by SSRF policy: ${ipCheck}`,
        };
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { safe: false, reason: `DNS resolution failed: ${msg}` };
  }

  return { safe: true };
}


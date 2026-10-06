import dns from 'node:dns';
import { config as loadDotEnv } from 'dotenv';

// DNS is imported before env.ts by every entry point, so load .env here before
// reading DNS_RESULT_ORDER. dotenv never overwrites supervisor-provided values.
loadDotEnv({ quiet: true });

/**
 * Configure Node.js DNS resolution order globally to prefer IPv4.
 *
 * Managed PostgreSQL services (Neon, Supabase, RDS) advertise dual-stack
 * (IPv4 'A' and IPv6 'AAAA') DNS records. On hosts, ISP networks, or containers
 * without routable IPv6 egress, the default IPv6-first resolution causes Node
 * TCP connect attempts to hang for 30-40 seconds until ETIMEDOUT occurs.
 *
 * Calling setDefaultResultOrder('ipv4first') at early bootstrap guarantees
 * instant connection handshakes across pg.Pool, PGMQ, Redis, and HTTP APIs.
 */
const configuredOrder = process.env.DNS_RESULT_ORDER;
const order = configuredOrder === 'verbatim' ? 'verbatim' : 'ipv4first';
if (typeof dns.setDefaultResultOrder === 'function') {
  try {
    dns.setDefaultResultOrder(order);
  } catch {
    // Ignore in environments where setting DNS order is restricted
  }
}

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
    }
    catch {
        // Ignore in environments where setting DNS order is restricted
    }
}
/**
 * Resilient fallback resolver for networks whose upstream ISP/corporate DNS server
 * refuses or drops dual-stack or *.neon.tech lookups.
 */
const resolver = new dns.promises.Resolver();
try {
    resolver.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
}
catch {
    // Ignore if custom servers cannot be set
}
const originalLookup = dns.lookup.bind(dns);
// Monkey-patch dns.lookup so all Node network primitives (pg, fetch, tls, http)
// fall back gracefully if the host OS resolver fails with ENOTFOUND.
dns.lookup = function (hostname, options, callback) {
    let cb = callback;
    let opts = options;
    if (typeof options === 'function') {
        cb = options;
        opts = {};
    }
    originalLookup(hostname, opts, (err, address, family) => {
        if (!err && address) {
            return cb(null, address, family);
        }
        // Only fallback for non-IP hostnames and lookup failure codes
        if (!hostname || hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
            return cb(err, address, family);
        }
        resolver
            .resolve4(hostname)
            .then((addresses) => {
            if (!addresses || addresses.length === 0) {
                return cb(err, address, family);
            }
            if (opts && typeof opts === 'object' && opts.all) {
                return cb(null, addresses.map((ip) => ({ address: ip, family: 4 })));
            }
            return cb(null, addresses[0], 4);
        })
            .catch(() => {
            cb(err, address, family);
        });
    });
};
//# sourceMappingURL=dns.js.map
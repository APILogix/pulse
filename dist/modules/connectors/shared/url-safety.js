import { lookup } from 'dns/promises';
import { isIP } from 'net';
const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal']);
const BLOCKED_SUFFIXES = ['.internal', '.local', '.localhost', '.corp', '.lan'];
export function isPrivateIp(ip) {
    const v = isIP(ip);
    if (v === 4) {
        const [a, b] = ip.split('.').map(Number);
        return (a === 0 || a === 10 || a === 127 || a >= 224 ||
            (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
            (a === 169 && b === 254) || // link-local / cloud metadata
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168));
    }
    if (v === 6) {
        const n = ip.toLowerCase();
        return n === '::' || n === '::1' || n.startsWith('fe80') ||
            n.startsWith('fc') || n.startsWith('fd') || n.startsWith('::ffff:0:');
    }
    return true;
}
/** Sync checks — safe to use inside Zod schemas. */
export function assertSafeHttpsUrl(raw) {
    const u = new URL(raw);
    if (u.protocol !== 'https:')
        throw new Error('Only https:// URLs are allowed');
    if (u.username || u.password)
        throw new Error('Credentials in URL are not allowed');
    const host = u.hostname.toLowerCase();
    if (BLOCKED_HOSTS.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
        throw new Error(`Hostname '${host}' is not allowed`);
    }
    if (isIP(host) && isPrivateIp(host))
        throw new Error('Private/link-local IPs are not allowed');
    return u;
}
/** Async DNS check — call from the service layer at create/update time. */
export async function assertPubliclyResolvable(u) {
    if (isIP(u.hostname))
        return; // literal IP already checked
    const { address } = await lookup(u.hostname);
    if (isPrivateIp(address)) {
        throw new Error(`Hostname '${u.hostname}' resolves to a private address`);
    }
}
//# sourceMappingURL=url-safety.js.map
import net from 'node:net';
/**
 * Parses DB_FAMILY without silently accepting an unsupported value.
 * Unset, an empty string, and 0 preserve Node's default address selection.
 */
export function parsePostgresAddressFamily(value) {
    if (value === undefined || value === null || value === '' || value === 0 || value === '0') {
        return undefined;
    }
    if (value === 4 || value === '4')
        return 4;
    if (value === 6 || value === '6')
        return 6;
    throw new Error('DB_FAMILY must be one of 0, 4, or 6');
}
/**
 * node-postgres currently retains a `family` pool option but does not forward it
 * to net.Socket.connect(). Its documented custom stream hook is therefore used
 * to enforce IPv4/IPv6 only when an explicit family is configured.
 */
function createAddressFamilyStream(family) {
    return () => {
        const socket = new net.Socket();
        const connect = socket.connect.bind(socket);
        // pg invokes stream.connect(port, host). Translate that positional call to
        // the options form so Node receives the requested address family.
        socket.connect = ((port, host, listener) => {
            const options = {
                port,
                family,
                ...(host ? { host } : {}),
            };
            return listener ? connect(options, listener) : connect(options);
        });
        return socket;
    };
}
/**
 * Adds an address-family override without changing any existing pool settings.
 * `family` remains present as diagnostic metadata; the stream enforces it.
 */
export function withPostgresAddressFamily(config, family) {
    if (family === undefined)
        return { ...config };
    return {
        ...config,
        family,
        stream: config.stream ?? createAddressFamilyStream(family),
    };
}
/** Produces a database target that can never include user names or passwords. */
export function getSafePostgresConnectionTarget(connectionString) {
    try {
        const url = new URL(connectionString);
        if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) {
            throw new Error('Invalid PostgreSQL connection string');
        }
        return {
            host: url.hostname,
            port: url.port ? Number(url.port) : 5432,
            database: decodeURIComponent(url.pathname.replace(/^\//, '')) || 'unknown',
        };
    }
    catch {
        // Never return the malformed connection string: it may contain credentials.
        return { host: 'invalid', port: 5432, database: 'unknown' };
    }
}
/** Produces connection diagnostics that can never include user names or passwords. */
export function getSafePostgresConnectionMetadata(connectionString, options) {
    return {
        ...getSafePostgresConnectionTarget(connectionString),
        family: options.family ?? 0,
        ssl: options.ssl !== false && options.ssl !== undefined,
        poolMax: options.poolMax,
        poolMin: options.poolMin,
    };
}
export function classifyPostgresHealthError(error) {
    const code = String(error?.code ?? '').toUpperCase();
    const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
    if (['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'ENODATA'].includes(code) || message.includes('getaddrinfo')) {
        return 'dns';
    }
    if (code === 'ETIMEDOUT' || message.includes('timeout'))
        return 'timeout';
    if (code.startsWith('ERR_TLS') ||
        code.startsWith('CERT_') ||
        message.includes('tls') ||
        message.includes('ssl') ||
        message.includes('certificate')) {
        return 'tls';
    }
    if (code.startsWith('28') ||
        message.includes('password authentication failed') ||
        message.includes('authentication failed') ||
        message.includes('no pg_hba.conf entry')) {
        return 'authentication';
    }
    if (['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE'].includes(code) ||
        message.includes('connect econnrefused') ||
        message.includes('network is unreachable')) {
        return 'tcp';
    }
    return 'query';
}
/** Table-independent PostgreSQL readiness probe with a safe failure category. */
export async function checkPostgresHealth(executor) {
    try {
        await executor.query('SELECT 1;');
        return { healthy: true };
    }
    catch (error) {
        return { healthy: false, failure: classifyPostgresHealthError(error) };
    }
}
//# sourceMappingURL=postgres-network.js.map
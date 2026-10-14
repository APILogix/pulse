import './dns.js';
const MANAGED_POSTGRES_HOST_SUFFIXES = [
    '.neon.tech',
    '.aws.neon.tech',
    'neon.tech',
    '.supabase.co',
    '.pooler.supabase.com',
    '.render.com',
    '.aivencloud.com',
    '.tembo.io',
    '.cockroachlabs.cloud',
    '.rds.amazonaws.com',
];
/**
 * Strips sslmode/ssl query parameters from connection string so pg-connection-string
 * does not override pool SSL options with weaker or conflicting defaults.
 */
export function sanitizePostgresConnectionString(connectionString) {
    try {
        const url = new URL(connectionString);
        if (url.searchParams.has('sslmode') || url.searchParams.has('ssl')) {
            url.searchParams.delete('sslmode');
            url.searchParams.delete('ssl');
            return url.toString();
        }
    }
    catch { }
    return connectionString;
}
/**
 * Resolves SSL configuration for PostgreSQL connections.
 * Automatically enables SSL for Neon, Supabase, and other managed Postgres platforms
 * while respecting explicit overrides and URL query parameters.
 */
export function resolvePostgresSslConfig(connectionString, options = {}) {
    if (options.enabled === false) {
        return false;
    }
    try {
        const url = new URL(connectionString);
        const sslMode = url.searchParams.get('sslmode')?.toLowerCase();
        const sslParam = url.searchParams.get('ssl')?.toLowerCase();
        if (sslMode === 'disable' || sslParam === 'false' || sslParam === '0') {
            return false;
        }
        // Explicit rejectUnauthorized option takes highest precedence
        if (options.rejectUnauthorized !== undefined) {
            return { rejectUnauthorized: options.rejectUnauthorized };
        }
        // Full certificate validation requested by URL query parameters
        if (sslMode === 'verify-full' || sslMode === 'verify-ca') {
            return { rejectUnauthorized: true };
        }
        if (options.enabled === true) {
            return { rejectUnauthorized: false };
        }
        if (sslMode === 'require' || sslMode === 'prefer' || sslMode === 'allow' || sslParam === 'true' || sslParam === '1') {
            return { rejectUnauthorized: false };
        }
        const host = url.hostname.toLowerCase();
        const isManagedCloudDb = MANAGED_POSTGRES_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(suffix));
        if (isManagedCloudDb) {
            return { rejectUnauthorized: false };
        }
    }
    catch {
        return false;
    }
    return false;
}
/**
 * Identifies expected serverless / idle disconnects from managed providers like Neon.
 * Neon suspends idle compute and PgBouncer closes idle sockets. When this occurs,
 * pool error listeners should log at debug level rather than fatal error level.
 */
export function isExpectedServerlessDisconnect(err) {
    if (!err)
        return false;
    const message = typeof err === 'string' ? err : err?.message || String(err);
    const code = err?.code;
    if (code && ['57P01', '57P02', '57P03', '08006', '08001', '08004', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT'].includes(code)) {
        return true;
    }
    return (message.includes('Connection terminated unexpectedly') ||
        message.includes('Connection ended unexpectedly') ||
        message.includes('Connection terminated due to connection timeout') ||
        message.includes('terminating connection') ||
        message.includes('server closed the connection unexpectedly') ||
        message.includes('read ECONNRESET') ||
        message.includes('write EPIPE') ||
        message.includes('ETIMEDOUT') ||
        message.includes('timeout exceeded when trying to connect'));
}
const NON_TRANSIENT_PREFIXES = ['28', '42', '23', '22', '3D', '0A'];
/**
 * Identifies transient connection errors that can be safely retried
 * during database operations or pg-boss background ticks.
 */
export function isTransientPostgresError(err) {
    if (!err)
        return false;
    const message = typeof err === 'string' ? err : err?.message || String(err);
    const code = err?.code;
    if (typeof code === 'string') {
        if (NON_TRANSIENT_PREFIXES.some((prefix) => code.startsWith(prefix))) {
            return false;
        }
    }
    if (message.includes('role "') ||
        message.includes('does not exist') ||
        message.includes('password authentication failed') ||
        message.includes('permission denied') ||
        message.includes('syntax error')) {
        return false;
    }
    if (isExpectedServerlessDisconnect(err)) {
        return true;
    }
    if (code && ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', '53300', '53000'].includes(code)) {
        return true;
    }
    return (message.includes('Client has encountered a connection error and is not queryable') ||
        message.includes('Connection terminated') ||
        message.includes('timeout exceeded') ||
        message.includes('connect ECONNREFUSED') ||
        message.includes('getaddrinfo EAI_AGAIN') ||
        message.includes('too many clients') ||
        message.includes('remaining connection slots') ||
        message.includes('too_many_connections') ||
        message.includes('connection limit exceeded'));
}
//# sourceMappingURL=postgres-ssl.js.map
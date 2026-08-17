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
 * Resolves SSL configuration for PostgreSQL connections.
 * Automatically enables SSL for Neon, Supabase, and other managed Postgres platforms
 * while respecting explicit overrides and URL query parameters.
 */
export function resolvePostgresSslConfig(connectionString, options = {}) {
    if (options.enabled !== undefined) {
        return options.enabled ? { rejectUnauthorized: options.rejectUnauthorized ?? false } : false;
    }
    try {
        const url = new URL(connectionString);
        const sslMode = url.searchParams.get('sslmode')?.toLowerCase();
        const sslParam = url.searchParams.get('ssl')?.toLowerCase();
        if (sslMode === 'disable' || sslParam === 'false' || sslParam === '0') {
            return false;
        }
        if (sslMode === 'require' || sslMode === 'verify-ca' || sslMode === 'verify-full') {
            return { rejectUnauthorized: sslMode !== 'require' && (options.rejectUnauthorized ?? false) };
        }
        if (sslMode === 'prefer' || sslMode === 'allow' || sslParam === 'true' || sslParam === '1') {
            return { rejectUnauthorized: options.rejectUnauthorized ?? false };
        }
        const host = url.hostname.toLowerCase();
        const isManagedCloudDb = MANAGED_POSTGRES_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(suffix));
        if (isManagedCloudDb) {
            return { rejectUnauthorized: options.rejectUnauthorized ?? false };
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
/**
 * Identifies transient connection errors that can be safely retried
 * during database operations or pg-boss background ticks.
 */
export function isTransientPostgresError(err) {
    if (isExpectedServerlessDisconnect(err)) {
        return true;
    }
    const message = typeof err === 'string' ? err : err?.message || String(err);
    const code = err?.code;
    if (code && ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN'].includes(code)) {
        return true;
    }
    return (message.includes('Client has encountered a connection error and is not queryable') ||
        message.includes('Connection terminated') ||
        message.includes('timeout exceeded') ||
        message.includes('connect ECONNREFUSED') ||
        message.includes('getaddrinfo EAI_AGAIN'));
}
//# sourceMappingURL=postgres-ssl.js.map
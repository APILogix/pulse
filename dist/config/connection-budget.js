import { env } from './env.js';
export function sanitizeDatabaseTarget(connectionString) {
    if (!connectionString)
        return 'unspecified';
    try {
        const parsed = new URL(connectionString);
        const host = parsed.hostname;
        const port = parsed.port || '5432';
        const database = parsed.pathname.replace(/^\//, '') || 'postgres';
        return `${host}:${port}/${database}`;
    }
    catch {
        return 'invalid_connection_string';
    }
}
function primaryPool(name = 'primary_pool') {
    return {
        name,
        max: env.DB_POOL_MAX,
        min: env.DB_POOL_MIN,
        idleTimeoutMs: env.DB_IDLE_TIMEOUT_MS,
        acquireTimeoutMs: env.DB_CONNECTION_TIMEOUT_MS,
        purpose: 'Control-plane transactions and background state transitions',
        poolingMode: 'transaction',
        targetEnvVar: 'DATABASE_URL',
    };
}
function logPools() {
    const primary = {
        name: 'logdb_primary_pool',
        max: env.LOG_POOL_MAX,
        min: env.LOG_POOL_MIN,
        idleTimeoutMs: env.LOG_DB_IDLE_TIMEOUT,
        acquireTimeoutMs: env.LOG_DB_CONNECTION_TIMEOUT,
        purpose: 'Telemetry reads, alert evaluation, and analytics queries',
        poolingMode: 'session',
        targetEnvVar: 'LOG_DB_PRIMARY',
    };
    const hasDistinctReplica = Boolean(env.LOG_DB_REPLICA && env.LOG_DB_REPLICA !== env.LOG_DB_PRIMARY);
    return hasDistinctReplica
        ? [
            primary,
            {
                ...primary,
                name: 'logdb_replica_pool',
                purpose: 'Optional read-only telemetry replica',
                targetEnvVar: 'LOG_DB_REPLICA',
            },
        ]
        : [primary];
}
function pgmqCommandPool(max = 2) {
    return {
        name: 'pgmq_command_pool',
        max,
        min: 0,
        idleTimeoutMs: env.DB_IDLE_TIMEOUT_MS,
        acquireTimeoutMs: env.DB_CONNECTION_TIMEOUT_MS,
        purpose: 'PGMQ enqueue operations (send / send_batch)',
        poolingMode: 'transaction',
        targetEnvVar: 'DATABASE_URL',
    };
}
function pgmqWorkerPools(readerMax = 4, commandMax = 3) {
    return [
        {
            name: 'pgmq_reader_pool',
            max: readerMax,
            min: 0,
            idleTimeoutMs: env.DB_IDLE_TIMEOUT_MS,
            acquireTimeoutMs: env.DB_CONNECTION_TIMEOUT_MS,
            purpose: 'PGMQ message reads and worker long-polling (session-mode isolated)',
            poolingMode: 'session',
            targetEnvVar: 'DATABASE_URL',
        },
        {
            name: 'pgmq_command_pool',
            max: commandMax,
            min: 0,
            idleTimeoutMs: env.DB_IDLE_TIMEOUT_MS,
            acquireTimeoutMs: env.DB_CONNECTION_TIMEOUT_MS,
            purpose: 'PGMQ send, ACK, delete, and heartbeat commands',
            poolingMode: 'transaction',
            targetEnvVar: 'DATABASE_URL',
        },
    ];
}
function budget(role, description, pools) {
    return {
        role,
        description,
        pools,
        totalMaxConnections: pools.reduce((sum, pool) => sum + pool.max, 0),
    };
}
export function getProcessBudget(role) {
    switch (role) {
        case 'api':
            // Fastify API only enqueues messages via pgmq.send; never allocate a blocking reader pool
            return budget(role, 'Fastify API server', [primaryPool(), ...logPools(), pgmqCommandPool(2)]);
        case 'worker':
            return budget(role, 'General background workers', [primaryPool(), ...logPools(), ...pgmqWorkerPools(4, 3)]);
        case 'alert-worker':
            return budget(role, 'Dedicated alert delivery workers', [primaryPool(), ...logPools(), ...pgmqWorkerPools(4, 3)]);
        case 'ingestion':
            return budget(role, 'High-throughput ingestion workers', [
                {
                    name: 'ingestion_control_pool',
                    max: env.INGESTION_DB_POOL_SIZE ?? 6,
                    min: 0,
                    idleTimeoutMs: env.DB_IDLE_TIMEOUT_MS,
                    acquireTimeoutMs: env.DB_CONNECTION_TIMEOUT_MS,
                    purpose: 'Usage rollups and ingestion control-plane operations',
                    poolingMode: 'transaction',
                    targetEnvVar: 'DATABASE_URL',
                },
                {
                    name: 'ingestion_write_pool',
                    max: env.INGESTION_WRITE_POOL_SIZE ?? 8,
                    min: 0,
                    idleTimeoutMs: env.LOG_DB_IDLE_TIMEOUT,
                    acquireTimeoutMs: env.LOG_DB_CONNECTION_TIMEOUT,
                    purpose: 'Dedicated telemetry persistence',
                    poolingMode: 'direct',
                    targetEnvVar: 'LOG_DB_DIRECT_URL',
                },
                ...pgmqWorkerPools(4, 4),
            ]);
        case 'analytics':
            return budget(role, 'Analytics and rollup workers', [
                {
                    name: 'analytics_logdb_pool',
                    max: env.ANALYTICS_DB_POOL_MAX ?? 6,
                    min: 0,
                    idleTimeoutMs: env.LOG_DB_IDLE_TIMEOUT,
                    acquireTimeoutMs: env.LOG_DB_CONNECTION_TIMEOUT,
                    purpose: 'Rollups, retention, and partition maintenance',
                    poolingMode: 'direct',
                    targetEnvVar: 'LOG_DB_DIRECT_URL',
                },
                ...pgmqWorkerPools(2, 2),
            ]);
        case 'cron':
            // Cron only dispatches scheduled jobs via pgmq.send; never allocate a blocking reader pool
            return budget(role, 'Scheduled PGMQ jobs', [primaryPool(), pgmqCommandPool(2)]);
        case 'migration':
            return budget(role, 'One-shot database migration runner', [
                {
                    name: 'migration_pool',
                    max: 5,
                    min: 0,
                    idleTimeoutMs: 10_000,
                    acquireTimeoutMs: env.DB_CONNECTION_TIMEOUT_MS,
                    purpose: 'Schema DDL and migrations',
                    poolingMode: 'direct',
                    targetEnvVar: 'DATABASE_URL',
                },
            ]);
    }
}
export function logProcessConnectionBudget(role, log) {
    const processBudget = getProcessBudget(role);
    log.info({
        processRole: processBudget.role,
        description: processBudget.description,
        totalMaxConnections: processBudget.totalMaxConnections,
        pools: processBudget.pools.map((pool) => {
            const rawConnection = pool.targetEnvVar === 'LOG_DB_REPLICA'
                ? env.LOG_DB_REPLICA
                : pool.targetEnvVar === 'LOG_DB_PRIMARY'
                    ? env.LOG_DB_PRIMARY ?? env.DATABASE_URL
                    : env.DATABASE_URL;
            return {
                poolName: pool.name,
                maxConnections: pool.max,
                minConnections: pool.min,
                poolingMode: pool.poolingMode,
                acquireTimeoutMs: pool.acquireTimeoutMs,
                idleTimeoutMs: pool.idleTimeoutMs,
                databaseTarget: sanitizeDatabaseTarget(rawConnection),
                purpose: pool.purpose,
            };
        }),
    }, 'database connection budget initialized for process');
}
//# sourceMappingURL=connection-budget.js.map
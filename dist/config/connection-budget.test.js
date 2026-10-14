import { describe, expect, it, vi } from 'vitest';
import { env } from './env.js';
import { getProcessBudget, logProcessConnectionBudget, sanitizeDatabaseTarget, } from './connection-budget.js';
describe('Connection Budget', () => {
    it('sanitizes database targets without leaking passwords or tokens', () => {
        expect(sanitizeDatabaseTarget('postgresql://postgres.user:secret_pass@db.example.supabase.co:6543/postgres?sslmode=require')).toBe('db.example.supabase.co:6543/postgres');
        expect(sanitizeDatabaseTarget('postgres://admin:pass123@localhost:5432/pulsiv_dev')).toBe('localhost:5432/pulsiv_dev');
        expect(sanitizeDatabaseTarget(undefined)).toBe('unspecified');
        expect(sanitizeDatabaseTarget('invalid-url')).toBe('invalid_connection_string');
    });
    const roles = [
        'api',
        'ingestion',
        'worker',
        'alert-worker',
        'analytics',
        'cron',
        'migration',
    ];
    it.each(roles)('defines explicit pool limits and total budget for %s', (role) => {
        const budget = getProcessBudget(role);
        expect(budget.role).toBe(role);
        expect(budget.pools.length).toBeGreaterThan(0);
        expect(budget.totalMaxConnections).toBeGreaterThan(0);
        for (const pool of budget.pools) {
            expect(pool.max).toBeGreaterThanOrEqual(1);
            expect(pool.acquireTimeoutMs).toBeGreaterThan(0);
            expect(pool.idleTimeoutMs).toBeGreaterThanOrEqual(0);
            expect(['transaction', 'session', 'direct']).toContain(pool.poolingMode);
            expect(pool.purpose).toBeTruthy();
        }
    });
    it('reports the actual persistent pool inventory for each runtime role', () => {
        const expectedLogPools = env.LOG_DB_REPLICA && env.LOG_DB_REPLICA !== env.LOG_DB_PRIMARY
            ? ['logdb_primary_pool', 'logdb_replica_pool']
            : ['logdb_primary_pool'];
        expect(getProcessBudget('api').pools.map((pool) => pool.name)).toEqual([
            'primary_pool',
            ...expectedLogPools,
            'pgmq_reader_pool',
            'pgmq_command_pool',
        ]);
        expect(getProcessBudget('worker').pools.map((pool) => pool.name)).toEqual([
            'primary_pool',
            ...expectedLogPools,
            'pgmq_reader_pool',
            'pgmq_command_pool',
        ]);
        expect(getProcessBudget('ingestion').pools.map((pool) => pool.name)).toEqual([
            'ingestion_control_pool',
            'ingestion_write_pool',
            'pgmq_reader_pool',
            'pgmq_command_pool',
        ]);
        expect(getProcessBudget('analytics').pools.map((pool) => pool.name)).toEqual([
            'analytics_logdb_pool',
            'pgmq_reader_pool',
            'pgmq_command_pool',
        ]);
        for (const role of roles) {
            const processBudget = getProcessBudget(role);
            expect(processBudget.totalMaxConnections).toBe(processBudget.pools.reduce((sum, pool) => sum + pool.max, 0));
        }
    });
    it('logs the connection budget with sanitized parameters', () => {
        const log = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        };
        logProcessConnectionBudget('ingestion', log);
        expect(log.info).toHaveBeenCalledWith(expect.objectContaining({
            processRole: 'ingestion',
            totalMaxConnections: expect.any(Number),
            pools: expect.arrayContaining([
                expect.objectContaining({
                    poolName: 'ingestion_write_pool',
                    maxConnections: expect.any(Number),
                    poolingMode: 'direct',
                    databaseTarget: expect.any(String),
                }),
            ]),
        }), 'database connection budget initialized for process');
    });
});
//# sourceMappingURL=connection-budget.test.js.map
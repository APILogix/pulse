/**
 * log-database.test.ts — tenant-scope (RLS) leak regression tests.
 *
 * ## What broke, and why it needs a test
 *
 * `getConnection()` used to apply the RLS tenant scope at CHECKOUT time with a
 * bare, session-scoped `SET app.current_project_id = $1`, before any `BEGIN`.
 * The value survived COMMIT and `client.release()`, so it stayed attached to the
 * connection in the `pg` pool and the next borrower inherited the previous
 * tenant's project id.
 *
 * This class of bug is invisible to ordinary testing: it only manifests on
 * connection reuse under concurrency, and only once something actually reads the
 * GUC. So the invariants are asserted directly against the emitted SQL:
 *
 *   1. Checkout emits NO tenant-scope statement at all.
 *   2. The scope is set with `set_config(..., true)` — transaction-scoped and
 *      parameterized — never a bare `SET`.
 *   3. The scope is applied AFTER `BEGIN` (before it, `is_local = true` is a
 *      silent no-op that fails open).
 *   4. Requesting a scope forces a transaction even when the timeout is 0,
 *      because otherwise there would be no transaction for it to be local to.
 *   5. The value is passed as a bind parameter, not interpolated into SQL.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/** A recorded `client.query(...)` invocation. */
interface Call {
  sql: string;
  params: unknown[] | undefined;
}

const calls: Call[] = [];
let released = 0;

const fakeClient = {
  query: vi.fn(async (sql: unknown, params?: unknown[]) => {
    calls.push({ sql: String(sql), params });
    return { rows: [], rowCount: 0 };
  }),
  release: vi.fn(() => {
    released += 1;
  }),
};

const fakePool = { connect: vi.fn(async () => fakeClient), on: vi.fn(), end: vi.fn() };

vi.mock('pg', () => ({
  Pool: class {
    connect = fakePool.connect;
    on = fakePool.on;
    end = fakePool.end;
  },
}));

vi.mock('./env.js', () => ({
  env: {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    LOG_DB_PRIMARY: 'postgresql://u:p@localhost:5432/logdb',
    LOG_DB_REPLICA: undefined,
    LOG_POOL_MAX: 20,
    LOG_POOL_MIN: 1,
    LOG_DB_IDLE_TIMEOUT: 30_000,
    LOG_DB_CONNECTION_TIMEOUT: 10_000,
    LOG_DB_KEEPALIVE_MS: 10_000,
    LOG_DB_SLOW_QUERY_MS: 1000,
    LOG_QUERY_TIMEOUT: 30_000,
    LOG_DB_WRITE_TIMEOUT: 0,
    LOG_RETRIES: 1,
    LOG_DB_SSL_ENABLED: undefined,
    LOG_DB_SSL_REJECT_UNAUTHORIZED: undefined,
    LOG_DB_AUTO_MIGRATE: false,
    TIMESCALEDB_ENABLED: false,
  },
}));

vi.mock('./logger.js', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('./postgres-ssl.js', () => ({
  resolvePostgresSslConfig: () => undefined,
  isExpectedServerlessDisconnect: () => false,
  sanitizePostgresConnectionString: (url: string) => url,
}));

const PROJECT = '11111111-2222-3333-4444-555555555555';
const OTHER_PROJECT = '99999999-8888-7777-6666-555555555555';

/** Any statement that establishes the tenant scope, in either old or new form. */
function tenantScopeCalls(): Call[] {
  return calls.filter(
    (c) => c.sql.includes('app.current_project_id') || /\bset_config\b/i.test(c.sql),
  );
}

let logDB: typeof import('./log-database.js')['logDB'];

beforeEach(async () => {
  calls.length = 0;
  released = 0;
  vi.clearAllMocks();
  vi.resetModules();
  ({ logDB } = await import('./log-database.js'));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LogDatabaseManager tenant scope — leak regression', () => {
  it('does not apply any tenant scope at connection checkout', async () => {
    await logDB.getConnection({ operation: 'read' });

    // The whole bug was that checkout mutated session state. Checkout must now
    // emit nothing at all.
    expect(calls).toHaveLength(0);
    expect(tenantScopeCalls()).toHaveLength(0);
  });

  it('never uses a bare session-scoped SET for the tenant scope', async () => {
    await logDB.queryWithRetry('SELECT 1', [], { projectId: PROJECT, operation: 'read' });

    const bareSet = calls.filter((c) => /^\s*SET\s+app\.current_project_id/i.test(c.sql));
    expect(bareSet).toHaveLength(0);
  });

  it('sets the tenant scope transaction-locally, with the value bound as a parameter', async () => {
    await logDB.queryWithRetry('SELECT 1', [], { projectId: PROJECT, operation: 'read' });

    const scope = tenantScopeCalls();
    expect(scope).toHaveLength(1);
    // is_local = true -> reverted automatically at COMMIT/ROLLBACK.
    expect(scope[0]?.sql).toMatch(/set_config\(\s*\$1\s*,\s*\$2\s*,\s*true\s*\)/i);
    // Bound, not interpolated: the project id must not appear in the SQL text.
    expect(scope[0]?.sql).not.toContain(PROJECT);
    expect(scope[0]?.params).toEqual(['app.current_project_id', PROJECT]);
  });

  it('applies the tenant scope AFTER BEGIN', async () => {
    await logDB.queryWithRetry('SELECT 1', [], { projectId: PROJECT, operation: 'read' });

    const beginIndex = calls.findIndex((c) => /^\s*BEGIN\s*$/i.test(c.sql));
    const scopeIndex = calls.findIndex((c) => /\bset_config\b/i.test(c.sql));

    expect(beginIndex).toBeGreaterThanOrEqual(0);
    expect(scopeIndex).toBeGreaterThan(beginIndex);
    // And the transaction actually closes, so the scope is reverted.
    expect(calls.some((c) => /^\s*COMMIT\s*$/i.test(c.sql))).toBe(true);
  });

  it('forces a transaction for a scoped query even when the timeout is disabled', async () => {
    // timeout 0 would normally take the no-transaction fast path. A tenant scope
    // must override that, or `is_local = true` silently applies to nothing.
    await logDB.queryWithRetry('SELECT 1', [], {
      projectId: PROJECT,
      operation: 'read',
      timeout: 0,
    });

    expect(calls.some((c) => /^\s*BEGIN\s*$/i.test(c.sql))).toBe(true);
    expect(tenantScopeCalls()).toHaveLength(1);
  });

  it('keeps the no-transaction fast path when neither timeout nor scope is requested', async () => {
    await logDB.queryWithRetry('SELECT 1', [], { operation: 'read', timeout: 0 });

    expect(calls.some((c) => /^\s*BEGIN\s*$/i.test(c.sql))).toBe(false);
    expect(tenantScopeCalls()).toHaveLength(0);
  });

  it('does not carry tenant scope across sequential queries on a reused connection', async () => {
    // The exact leak scenario: tenant A runs a scoped query, then tenant B runs
    // an UNSCOPED query on the same (pooled) connection. B must emit no scope
    // statement, and A's scope must have been transaction-local so it is gone.
    await logDB.queryWithRetry('SELECT 1', [], { projectId: PROJECT, operation: 'read' });
    const afterFirst = calls.length;

    await logDB.queryWithRetry('SELECT 2', [], { operation: 'read' });

    const secondQueryCalls = calls.slice(afterFirst);
    expect(secondQueryCalls.some((c) => c.sql.includes('app.current_project_id'))).toBe(false);
    expect(secondQueryCalls.some((c) => c.sql.includes(PROJECT))).toBe(false);
  });

  it('scopes each query to its own tenant, with one scope statement per query', async () => {
    await logDB.queryWithRetry('SELECT 1', [], { projectId: PROJECT, operation: 'read' });
    await logDB.queryWithRetry('SELECT 2', [], { projectId: OTHER_PROJECT, operation: 'read' });

    const scope = tenantScopeCalls();
    expect(scope).toHaveLength(2);
    expect(scope[0]?.params).toEqual(['app.current_project_id', PROJECT]);
    expect(scope[1]?.params).toEqual(['app.current_project_id', OTHER_PROJECT]);
  });

  it('applies the tenant scope inside the transaction for withTransaction', async () => {
    await logDB.withTransaction(async (client) => {
      await client.query('INSERT INTO t VALUES (1)');
    }, { projectId: PROJECT });

    const beginIndex = calls.findIndex((c) => /^\s*BEGIN\s*$/i.test(c.sql));
    const scopeIndex = calls.findIndex((c) => /\bset_config\b/i.test(c.sql));
    const workIndex = calls.findIndex((c) => c.sql.includes('INSERT INTO t'));

    expect(beginIndex).toBeGreaterThanOrEqual(0);
    // Ordering matters: BEGIN -> scope -> work.
    expect(scopeIndex).toBeGreaterThan(beginIndex);
    expect(workIndex).toBeGreaterThan(scopeIndex);
    expect(released).toBe(1);
  });

  it('emits no tenant scope for withTransaction when no projectId is given', async () => {
    await logDB.withTransaction(async (client) => {
      await client.query('INSERT INTO t VALUES (1)');
    });

    expect(tenantScopeCalls()).toHaveLength(0);
  });

  it('reverts the scope via ROLLBACK when the transaction body throws', async () => {
    await expect(
      logDB.withTransaction(async () => {
        throw new Error('boom');
      }, { projectId: PROJECT }),
    ).rejects.toThrow('boom');

    // ROLLBACK discards a transaction-scoped setting just as COMMIT does.
    expect(calls.some((c) => /^\s*ROLLBACK\s*$/i.test(c.sql))).toBe(true);
    expect(released).toBe(1);
  });
});

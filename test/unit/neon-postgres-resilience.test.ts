import { describe, expect, it, vi } from 'vitest';
import {
  isExpectedServerlessDisconnect,
  isTransientPostgresError,
  resolvePostgresSslConfig,
} from '../../src/config/postgres-ssl.js';
import { ResilientPgBossDb } from '../../src/lib/pgboss.js';

describe('Neon Postgres SSL Resolution', () => {
  it('automatically enables SSL for Neon direct URLs without query params', () => {
    const url = 'postgresql://user:pass@ep-cool-project-123456.us-east-2.aws.neon.tech/neondb';
    const ssl = resolvePostgresSslConfig(url);
    expect(ssl).toEqual({ rejectUnauthorized: false });
  });

  it('automatically enables SSL for Neon pooled URLs', () => {
    const url = 'postgresql://user:pass@ep-cool-project-123456-pooler.us-east-2.aws.neon.tech/neondb';
    const ssl = resolvePostgresSslConfig(url);
    expect(ssl).toEqual({ rejectUnauthorized: false });
  });

  it('automatically enables SSL for Supabase hostnames', () => {
    const url = 'postgresql://postgres:pass@db.xyz.supabase.co:5432/postgres';
    const ssl = resolvePostgresSslConfig(url);
    expect(ssl).toEqual({ rejectUnauthorized: false });
  });

  it('honors sslmode=disable even on Neon URLs', () => {
    const url = 'postgresql://user:pass@ep-cool-project-123456.us-east-2.aws.neon.tech/neondb?sslmode=disable';
    const ssl = resolvePostgresSslConfig(url);
    expect(ssl).toBe(false);
  });

  it('honors explicit enabled=false override', () => {
    const url = 'postgresql://user:pass@ep-cool-project-123456.us-east-2.aws.neon.tech/neondb';
    const ssl = resolvePostgresSslConfig(url, { enabled: false });
    expect(ssl).toBe(false);
  });

  it('honors explicit rejectUnauthorized=true', () => {
    const url = 'postgresql://user:pass@ep-cool-project-123456.us-east-2.aws.neon.tech/neondb';
    const ssl = resolvePostgresSslConfig(url, { rejectUnauthorized: true });
    expect(ssl).toEqual({ rejectUnauthorized: true });
  });
});

describe('Postgres Serverless & Transient Error Classification', () => {
  it('correctly identifies Neon / serverless expected disconnect errors', () => {
    expect(isExpectedServerlessDisconnect(new Error('Connection terminated due to connection timeout'))).toBe(true);
    expect(isExpectedServerlessDisconnect(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isExpectedServerlessDisconnect(new Error('Connection ended unexpectedly'))).toBe(true);
    expect(isExpectedServerlessDisconnect(new Error('server closed the connection unexpectedly'))).toBe(true);
    expect(isExpectedServerlessDisconnect(new Error('read ECONNRESET'))).toBe(true);
    expect(isExpectedServerlessDisconnect(new Error('write EPIPE'))).toBe(true);
    expect(isExpectedServerlessDisconnect({ code: '57P01', message: 'terminating connection due to administrator command' })).toBe(true);
    expect(isExpectedServerlessDisconnect({ code: '08006', message: 'connection_failure' })).toBe(true);
  });

  it('correctly identifies transient connection errors that can be retried', () => {
    expect(isTransientPostgresError(new Error('Connection terminated due to connection timeout'))).toBe(true);
    expect(isTransientPostgresError(new Error('Client has encountered a connection error and is not queryable'))).toBe(true);
    expect(isTransientPostgresError(new Error('connect ECONNREFUSED 127.0.0.1:5432'))).toBe(true);
    expect(isTransientPostgresError({ code: 'ECONNRESET', message: 'socket reset' })).toBe(true);
  });

  it('does not classify non-transient application/schema errors as transient', () => {
    expect(isTransientPostgresError(new Error('syntax error at or near "SELECTT"'))).toBe(false);
    expect(isTransientPostgresError(new Error('duplicate key value violates unique constraint "users_email_key"'))).toBe(false);
    expect(isExpectedServerlessDisconnect(new Error('column "foo" does not exist'))).toBe(false);
  });
});

describe('ResilientPgBossDb Adapter', () => {
  it('retries executeSql when receiving a transient connection timeout/termination error', async () => {
    const db = new ResilientPgBossDb({
      connectionString: 'postgresql://mock:mock@localhost:5432/mock',
    });

    let attempts = 0;
    const mockPool = {
      query: vi.fn(async (_text: string, _values?: unknown[]) => {
        attempts++;
        if (attempts === 1) {
          throw new Error('Connection terminated due to connection timeout');
        }
        return { rows: [{ id: 1, name: 'pg-boss-test' }] };
      }),
      end: vi.fn(async () => {}),
      on: vi.fn(),
    };

    db.pool = mockPool as any;
    db.opened = true;

    const result = await db.executeSql('SELECT 1');
    expect(attempts).toBe(2);
    expect(result.rows).toEqual([{ id: 1, name: 'pg-boss-test' }]);
  });

  it('fails fast on non-transient SQL syntax errors without wasteful retries', async () => {
    const db = new ResilientPgBossDb({
      connectionString: 'postgresql://mock:mock@localhost:5432/mock',
    });

    let attempts = 0;
    const mockPool = {
      query: vi.fn(async () => {
        attempts++;
        throw new Error('syntax error at or near "SELEC"');
      }),
      end: vi.fn(async () => {}),
      on: vi.fn(),
    };

    db.pool = mockPool as any;
    db.opened = true;

    await expect(db.executeSql('SELEC 1')).rejects.toThrow('syntax error at or near "SELEC"');
    expect(attempts).toBe(1);
  });

  it('executes transactions correctly with withTransaction', async () => {
    const db = new ResilientPgBossDb({
      connectionString: 'postgresql://mock:mock@localhost:5432/mock',
    });

    const mockClient = {
      query: vi.fn(async (text: string) => {
        if (text === 'SELECT 42 AS val') {
          return { rows: [{ val: 42 }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    const mockPool = {
      connect: vi.fn(async () => mockClient),
      end: vi.fn(async () => {}),
      on: vi.fn(),
    };

    db.pool = mockPool as any;
    db.opened = true;

    const result = await db.withTransaction(async (tx) => {
      const res = await tx.executeSql('SELECT 42 AS val');
      return res.rows[0].val;
    });

    expect(result).toBe(42);
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });
});

import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkPostgresHealth,
  classifyPostgresHealthError,
  getSafePostgresConnectionMetadata,
  parsePostgresAddressFamily,
  withPostgresAddressFamily,
} from '../../src/config/postgres-network.js';
import { resolvePostgresSslConfig } from '../../src/config/postgres-ssl.js';

describe('PostgreSQL address-family configuration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([undefined, '', 0, '0'])(
    'leaves the family unset for the automatic value %s',
    (value) => {
      expect(parsePostgresAddressFamily(value)).toBeUndefined();
    },
  );

  it.each([
    [4, 4],
    ['4', 4],
    [6, 6],
    ['6', 6],
  ] as const)('accepts DB_FAMILY=%s', (value, expected) => {
    expect(parsePostgresAddressFamily(value)).toBe(expected);
  });

  it.each(['invalid', 5, '46', true])('rejects invalid DB_FAMILY=%s', (value) => {
    expect(() => parsePostgresAddressFamily(value)).toThrow(
      'DB_FAMILY must be one of 0, 4, or 6',
    );
  });

  it('does not add a family or stream override in automatic mode', () => {
    const base = {
      connectionString: 'postgresql://user:pass@localhost:5432/pulse',
      ssl: { rejectUnauthorized: false },
      max: 10,
      min: 2,
      connectionTimeoutMillis: 12_345,
    };

    const configured = withPostgresAddressFamily(base, undefined);

    expect(configured).toEqual(base);
    expect(configured).not.toHaveProperty('family');
    expect(configured).not.toHaveProperty('stream');
  });

  it.each([4, 6] as const)('preserves pool and SSL settings while enforcing IPv%s', (family) => {
    const nativeConnect = vi
      .spyOn(net.Socket.prototype, 'connect')
      .mockImplementation(function mockConnect() {
        return this;
      } as typeof net.Socket.prototype.connect);
    const ssl = { rejectUnauthorized: false };
    const configured = withPostgresAddressFamily({
      connectionString: 'postgresql://user:pass@db.example.test:6543/postgres',
      ssl,
      max: 10,
      min: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
    }, family);

    expect(configured).toMatchObject({
      family,
      ssl,
      max: 10,
      min: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
    });

    const socket = configured.stream!();
    expect(socket).toBeDefined();
    (socket as net.Socket).connect(6543, 'db.example.test');
    expect(nativeConnect).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'db.example.test', port: 6543, family }),
    );
  });
});

describe('PostgreSQL diagnostics', () => {
  it('keeps Supabase SSL enabled', () => {
    const ssl = resolvePostgresSslConfig(
      'postgresql://user:pass@aws-0-ap-south-1.pooler.supabase.com:6543/postgres',
    );
    expect(ssl).toEqual({ rejectUnauthorized: false });
  });

  it('never includes credentials in safe startup metadata', () => {
    const metadata = getSafePostgresConnectionMetadata(
      'postgresql://sensitive-user:super-secret@aws-0-ap-south-1.pooler.supabase.com:6543/postgres',
      {
        family: 6,
        ssl: { rejectUnauthorized: false },
        poolMax: 10,
        poolMin: 2,
      },
    );
    const serialized = JSON.stringify(metadata);

    expect(metadata).toEqual({
      host: 'aws-0-ap-south-1.pooler.supabase.com',
      port: 6543,
      database: 'postgres',
      family: 6,
      ssl: true,
      poolMax: 10,
      poolMin: 2,
    });
    expect(serialized).not.toContain('sensitive-user');
    expect(serialized).not.toContain('super-secret');
    expect(serialized).not.toContain('postgresql://');
  });

  it('does not echo a malformed connection string', () => {
    const metadata = getSafePostgresConnectionMetadata('not-a-url:secret-value', {
      ssl: false,
      poolMax: 5,
      poolMin: 0,
    });
    expect(JSON.stringify(metadata)).not.toContain('secret-value');
    expect(metadata.host).toBe('invalid');
  });
});

describe('PostgreSQL health checks', () => {
  it('uses the table-independent SELECT 1 query', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
    await expect(checkPostgresHealth({ query } as never)).resolves.toEqual({ healthy: true });
    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith('SELECT 1;');
  });

  it.each([
    [{ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND host' }, 'dns'],
    [{ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' }, 'tcp'],
    [{ code: 'ERR_TLS_CERT_ALTNAME_INVALID', message: 'TLS certificate failed' }, 'tls'],
    [{ code: '28P01', message: 'password authentication failed' }, 'authentication'],
    [{ code: 'ETIMEDOUT', message: 'connection timeout' }, 'timeout'],
    [{ code: '42P01', message: 'relation does not exist' }, 'query'],
  ] as const)('classifies %s as %s', (error, expected) => {
    expect(classifyPostgresHealthError(error)).toBe(expected);
  });

  it('returns only a safe failure category when the query fails', async () => {
    const query = vi.fn().mockRejectedValue(
      Object.assign(new Error('password authentication failed for secret-user'), { code: '28P01' }),
    );
    await expect(checkPostgresHealth({ query } as never)).resolves.toEqual({
      healthy: false,
      failure: 'authentication',
    });
  });
});

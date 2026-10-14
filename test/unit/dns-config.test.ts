import { afterEach, describe, expect, it, vi } from 'vitest';

const setDefaultResultOrder = vi.fn();
const loadDotEnv = vi.fn();

vi.mock('dotenv', () => ({ config: loadDotEnv }));

vi.mock('node:dns', () => ({
  default: {
    setDefaultResultOrder,
  },
}));

async function importFreshDnsConfig(): Promise<void> {
  vi.resetModules();
  await import('../../src/config/dns.ts');
}

describe('DNS result order bootstrap', () => {
  afterEach(() => {
    delete process.env.DNS_RESULT_ORDER;
    setDefaultResultOrder.mockClear();
    loadDotEnv.mockReset();
  });

  it('defaults to IPv4-first to avoid unroutable IPv6 Postgres endpoints', async () => {
    await importFreshDnsConfig();

    expect(setDefaultResultOrder).toHaveBeenCalledWith('ipv4first');
  });

  it('loads .env before reading DNS_RESULT_ORDER', async () => {
    loadDotEnv.mockImplementation(() => {
      process.env.DNS_RESULT_ORDER = 'verbatim';
      return {} as never;
    });

    await importFreshDnsConfig();

    expect(loadDotEnv).toHaveBeenCalledOnce();
    expect(setDefaultResultOrder).toHaveBeenCalledWith('verbatim');
    expect(loadDotEnv.mock.invocationCallOrder[0]).toBeLessThan(
      setDefaultResultOrder.mock.invocationCallOrder[0]!,
    );
  });

  it('allows verbatim DNS ordering when explicitly requested', async () => {
    process.env.DNS_RESULT_ORDER = 'verbatim';

    await importFreshDnsConfig();

    expect(setDefaultResultOrder).toHaveBeenCalledWith('verbatim');
  });
});

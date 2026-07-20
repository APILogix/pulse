import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();

vi.mock('../../../src/config/database.js', () => ({
  pool: {
    query,
  },
}));

async function createRepository() {
  const { AlertPreferencesRepository } = await import('../../../src/modules/projects/alerts/preferences/alert-preferences.repository.js');
  return new AlertPreferencesRepository();
}

describe('AlertPreferencesRepository.bulkSubscribe', () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue({ rows: [] });
  });

  it('uses parameterized placeholders and does not interpolate user input', async () => {
    const repo = await createRepository();
    const maliciousUserId = "'); DROP TABLE users; --";
    await repo.bulkSubscribe(
      'project-id',
      'email',
      'error',
      [maliciousUserId],
    );

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0]!;

    // The SQL must use placeholders, not string interpolation.
    expect(sql).not.toContain(maliciousUserId);
    expect(values).toContain(maliciousUserId);

    // Expect exactly one placeholder group with 4 params.
    expect(sql).toContain('($1, $2, $3, $4, TRUE)');
    expect(values).toEqual(['project-id', maliciousUserId, 'email', 'error']);
  });

  it('generates multiple placeholder groups for multiple users', async () => {
    const repo = await createRepository();
    await repo.bulkSubscribe(
      'project-id',
      'slack',
      'critical',
      ['user-1', 'user-2'],
    );

    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('($1, $2, $3, $4, TRUE), ($5, $6, $7, $8, TRUE)');
    expect(values).toEqual([
      'project-id', 'user-1', 'slack', 'critical',
      'project-id', 'user-2', 'slack', 'critical',
    ]);
  });

  it('short-circuits on empty user list', async () => {
    const repo = await createRepository();
    await repo.bulkSubscribe('project-id', 'email', 'error', []);
    expect(query).not.toHaveBeenCalled();
  });
});

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
      'organization-id',
      'project-id',
      'email',
      'error',
      [maliciousUserId],
    );

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0]!;

    // The SQL must use placeholders, not string interpolation.
    expect(sql).not.toContain(maliciousUserId);
    expect(values[4]).toContain(maliciousUserId);

    expect(sql).toContain('unnest($5::uuid[])');
    expect(values).toEqual(['organization-id', 'project-id', 'email', 'error', [maliciousUserId]]);
  });

  it('generates multiple placeholder groups for multiple users', async () => {
    const repo = await createRepository();
    await repo.bulkSubscribe(
      'organization-id',
      'project-id',
      'slack',
      'critical',
      ['user-1', 'user-2'],
    );

    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('project_member_alert_channel_preferences');
    expect(sql).toContain('project_alert_channels');
    expect(values).toEqual([
      'organization-id', 'project-id', 'slack', 'critical', ['user-1', 'user-2'],
    ]);
  });

  it('short-circuits on empty user list', async () => {
    const repo = await createRepository();
    await repo.bulkSubscribe('organization-id', 'project-id', 'email', 'error', []);
    expect(query).not.toHaveBeenCalled();
  });
});

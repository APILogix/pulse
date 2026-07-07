import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  listMigrationFiles,
  readMigrationSql,
  resolveMigrationDirOverride,
  resolveMigrationDirOverrideFromArgs,
} from '../../scripts/lib/migrations.js';

describe('migration file discovery', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('finds nested up migrations and returns relative paths in lexicographic order', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'migration-tree-'));
    tempDirs.push(root);

    await mkdir(path.join(root, '01_auth'), { recursive: true });
    await mkdir(path.join(root, '00_shared'), { recursive: true });
    await writeFile(path.join(root, '01_auth', '002_create_users.up.sql'), 'SELECT 2;');
    await writeFile(path.join(root, '00_shared', '001_enable_pgcrypto.up.sql'), 'SELECT 1;');
    await writeFile(path.join(root, 'README.md'), '# ignored');

    const files = await listMigrationFiles(root);

    expect(files).toEqual([
      '00_shared/001_enable_pgcrypto.up.sql',
      '01_auth/002_create_users.up.sql',
    ]);

    const sql = await readMigrationSql(files[0]!, root);
    expect(sql).toContain('SELECT 1;');
  });

  it('supports explicit migration directory overrides by env', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'migration-override-'));
    tempDirs.push(root);

    expect(resolveMigrationDirOverride({ MIGRATIONS_DIR: root } as NodeJS.ProcessEnv)).toBe(root);
  });

  it('supports draft selection from CLI args', async () => {
    expect(resolveMigrationDirOverrideFromArgs(['--migrations-profile', 'draft']))
      .toContain('canonical_migrations_draft');
  });
});

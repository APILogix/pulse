import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LOGDB_MIGRATIONS_DIR = path.resolve(__dirname, '../../../database/migrations/logdb');
export const LOGDB_MIGRATION_LOCK_KEY = 74_373_201;
/**
 * Serialize forward and rollback operations without waiting indefinitely.
 * Advisory locks are session-scoped, so callers must hold the same client
 * until releaseLogDbMigrationLock() completes.
 */
export async function acquireLogDbMigrationLock(client) {
    const result = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [LOGDB_MIGRATION_LOCK_KEY]);
    if (result.rows[0]?.acquired !== true) {
        throw new Error('Another Log DB migration or rollback already holds the migration lock');
    }
}
export async function releaseLogDbMigrationLock(client) {
    await client.query('SELECT pg_advisory_unlock($1)', [LOGDB_MIGRATION_LOCK_KEY]);
}
function isLogDbMigrationFile(filename) {
    if (!filename.endsWith('.sql'))
        return false;
    if (filename.endsWith('.down.sql'))
        return false;
    return filename.endsWith('.up.sql') || !filename.endsWith('.down.sql');
}
export async function findLogDbMigrationFiles(dir = LOGDB_MIGRATIONS_DIR, root = dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const filepath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await findLogDbMigrationFiles(filepath, root));
            continue;
        }
        if (!entry.isFile() || !isLogDbMigrationFile(entry.name))
            continue;
        files.push({
            filename: path.relative(root, filepath).replace(/\\/g, '/'),
            filepath,
            basename: path.basename(entry.name, '.sql').replace(/\.up$/, ''),
        });
    }
    return files.sort((a, b) => a.filename.localeCompare(b.filename));
}
async function ensureMigrationsTable(client) {
    await client.query(`
    CREATE TABLE IF NOT EXISTS logdb_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      duration_ms INTEGER
    )
  `);
}
async function hasMigrationBeenApplied(client, filename) {
    const applied = await client.query('SELECT id FROM logdb_migrations WHERE filename = $1', [filename]);
    return applied.rows.length > 0;
}
async function recordMigration(client, filename, durationMs) {
    await client.query(`INSERT INTO logdb_migrations (filename, applied_at, duration_ms)
     VALUES ($1, NOW(), $2)
     ON CONFLICT (filename) DO NOTHING`, [filename, durationMs]);
}
function hasExplicitTransaction(sql) {
    const normalized = sql.trim().toUpperCase();
    return normalized.startsWith('BEGIN;') && normalized.includes('COMMIT;');
}
function hasNoTransactionDirective(sql) {
    return /^--\s*codex-logdb-migration:\s*no-transaction\b/im.test(sql);
}
export function requiresOperatorDrain(sql) {
    return /^--\s*codex-logdb-migration:\s*requires-operator-drain\b/im.test(sql);
}
async function executeNoTransactionMigration(client, sql) {
    const statements = sql
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean);
    for (const statement of statements) {
        await client.query(`${statement};`);
    }
}
async function applyOneMigration(client, migration, dryRun, executionMode) {
    if (await hasMigrationBeenApplied(client, migration.filename)) {
        return { status: 'already-applied', durationMs: 0 };
    }
    if (dryRun) {
        return { status: 'dry-run', durationMs: 0 };
    }
    const sql = await fs.readFile(migration.filepath, 'utf8');
    if (executionMode === 'automatic' && requiresOperatorDrain(sql)) {
        return { status: 'deferred', durationMs: 0 };
    }
    if (sql.trim().length === 0) {
        await recordMigration(client, migration.filename, 0);
        return { status: 'applied', durationMs: 0 };
    }
    const startedAt = Date.now();
    const explicitTx = hasExplicitTransaction(sql);
    if (explicitTx) {
        await client.query(sql);
    }
    else if (hasNoTransactionDirective(sql)) {
        await executeNoTransactionMigration(client, sql);
    }
    else {
        await client.query('BEGIN');
        try {
            await client.query(sql);
            await client.query('COMMIT');
        }
        catch (err) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw err;
        }
    }
    const durationMs = Date.now() - startedAt;
    await recordMigration(client, migration.filename, durationMs);
    return { status: 'applied', durationMs };
}
export async function applyLogDbMigrations(pool, options = {}) {
    const dryRun = options.dryRun === true;
    const executionMode = options.executionMode ?? 'operator';
    const allMigrations = await findLogDbMigrationFiles();
    const filters = options.only?.map((value) => value.trim()).filter(Boolean) ?? [];
    const migrations = filters.length === 0
        ? allMigrations
        : allMigrations.filter((migration) => filters.some((filter) => migration.filename.startsWith(filter) || migration.basename.startsWith(filter)));
    const result = {
        directory: LOGDB_MIGRATIONS_DIR,
        found: migrations.length,
        applied: 0,
        skipped: 0,
        deferred: 0,
        failed: 0,
    };
    const client = await pool.connect();
    let lockAcquired = false;
    try {
        await acquireLogDbMigrationLock(client);
        lockAcquired = true;
        await ensureMigrationsTable(client);
        for (const migration of migrations) {
            try {
                const outcome = await applyOneMigration(client, migration, dryRun, executionMode);
                if (outcome.status === 'applied') {
                    result.applied += 1;
                    options.logger?.info({ migration: migration.filename, durationMs: outcome.durationMs }, 'Log DB migration applied');
                }
                else if (outcome.status === 'deferred') {
                    result.skipped += 1;
                    result.deferred += 1;
                    options.logger?.warn({
                        migration: migration.filename,
                        executionMode,
                        operatorCommand: `npm run db:migrate:logdb -- --only ${migration.filename}`,
                    }, 'Operator-drained Log DB migration deferred during automatic startup');
                }
                else {
                    result.skipped += 1;
                    options.logger?.debug({ migration: migration.filename, dryRun, executionMode }, outcome.status === 'dry-run'
                        ? 'Log DB migration dry-run skipped'
                        : 'Log DB migration already applied');
                }
            }
            catch (err) {
                result.failed += 1;
                options.logger?.error({ err, migration: migration.filename }, 'Log DB migration failed');
                throw err;
            }
        }
        options.logger?.info({
            executionMode,
            found: result.found,
            applied: result.applied,
            skipped: result.skipped,
            deferred: result.deferred,
            failed: result.failed,
        }, 'Log DB migrations complete');
        return result;
    }
    finally {
        if (lockAcquired) {
            await releaseLogDbMigrationLock(client).catch(() => undefined);
        }
        client.release();
    }
}
//# sourceMappingURL=migrations.js.map
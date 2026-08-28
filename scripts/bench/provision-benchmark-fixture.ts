/**
 * Provision (idempotently) a real, clearly-tagged benchmark organization,
 * project, environment, and API key for the HTTP-level ingestion benchmark.
 *
 * This is fixture provisioning, not a bypass of the ingestion path: the rows
 * created here are exactly the rows the real signup/project-creation flow
 * would create, using the SAME key-material generator
 * (`src/modules/projects/shared/utils.ts#createApiKey`) and the SAME hash
 * algorithm `IngestionService`/`PostgresWriter.resolveApiKey()` verifies
 * against (sha256 of the full key, `postgress.writter.ts:77-140`). Once
 * provisioned, every ingestion request in this benchmark goes through the
 * real HTTP gateway, the real auth resolution SQL, and the real pg-boss
 * enqueue path — nothing about ingestion itself is short-circuited.
 *
 * Safety:
 *   - Refuses to run unless `--environment` resolves to an allowlisted
 *     benchmark/staging label (scripts/lib/ingestion-evidence.ts).
 *   - Every created row is tagged: organization/project/environment names and
 *     slugs are prefixed `pulse-bench-`, and `projects.metadata` carries
 *     `{ benchmark: true, benchmarkRunTag }` so operators can find and prune
 *     everything this script created with one query (see --print-cleanup-sql).
 *   - Idempotent: re-running with the same `--tag` finds and reuses existing
 *     rows instead of creating duplicates, and never mutates unrelated data.
 *   - Never touches production-looking orgs: it only ever creates its own
 *     tagged rows and only ever reads/upserts rows carrying its own tag.
 *
 * Usage:
 *   npx tsx scripts/bench/provision-benchmark-fixture.ts --environment benchmark --tag smoke1
 *   npx tsx scripts/bench/provision-benchmark-fixture.ts --environment benchmark --tag smoke1 --print-cleanup-sql
 */
import { randomBytes, randomUUID } from 'crypto';
import { Pool } from 'pg';
import { config } from 'dotenv';
import { createApiKey } from '../../src/modules/projects/shared/utils.js';
import { assertBenchEnvironment } from '../lib/ingestion-evidence.js';

config();

interface CliOptions {
  environment: string;
  tag: string;
  databaseUrl: string;
  printCleanupSql: boolean;
  planTier: 'free' | 'starter' | 'growth' | 'business' | 'enterprise';
}

interface ProvisionedFixture {
  tag: string;
  organizationId: string;
  organizationSlug: string;
  projectId: string;
  projectSlug: string;
  environmentId: string;
  environmentSlug: string;
  apiKeyId: string;
  /** Full raw key, printed once. Never stored in plaintext anywhere. */
  fullApiKey: string;
  planTier: string;
}

function usage(): void {
  console.error(`Usage:
  npx tsx scripts/bench/provision-benchmark-fixture.ts --environment <label> --tag <tag> [options]

Required:
  --environment <label>   Must resolve against INGESTION_BENCH_ENV_ALLOWLIST
                           (default: staging,bench,benchmark,local).
  --tag <tag>              Short identifier (letters/digits/hyphens) reused to
                           make this script idempotent across runs.

Options:
  --database-url <url>    Defaults to $DATABASE_URL.
  --plan-tier <tier>      free|starter|growth|business|enterprise (default: free).
  --print-cleanup-sql     Print a DELETE script that removes only this tag's
                           rows, then exit without provisioning.
`);
  process.exit(2);
}

function parseArgs(): CliOptions {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = process.argv[i + 1];
    if (!value || value.startsWith('--')) args[key] = true;
    else {
      args[key] = value;
      i += 1;
    }
  }
  if (args.help === true || args.h === true) usage();
  const environment = typeof args.environment === 'string' ? args.environment : '';
  const tag = typeof args.tag === 'string' ? args.tag : '';
  if (!environment || !tag) usage();
  if (!/^[a-zA-Z0-9-]{1,40}$/.test(tag)) {
    throw new Error(`--tag ${JSON.stringify(tag)} must match [a-zA-Z0-9-]{1,40}`);
  }
  const planTier = typeof args['plan-tier'] === 'string' ? args['plan-tier'] : 'free';
  if (!['free', 'starter', 'growth', 'business', 'enterprise'].includes(planTier)) {
    throw new Error(`Unsupported --plan-tier ${planTier}`);
  }
  return {
    environment,
    tag,
    databaseUrl: typeof args['database-url'] === 'string' ? args['database-url'] : String(process.env.DATABASE_URL ?? ''),
    printCleanupSql: args['print-cleanup-sql'] === true,
    planTier: planTier as CliOptions['planTier'],
  };
}

/** Everything this script creates carries this literal prefix, so cleanup and audit are one grep away. */
export const BENCH_FIXTURE_PREFIX = 'pulse-bench-' as const;

function slugFor(tag: string, suffix: string): string {
  return `${BENCH_FIXTURE_PREFIX}${tag}-${suffix}`.toLowerCase();
}

function cleanupSql(tag: string): string {
  const like = `${BENCH_FIXTURE_PREFIX}${tag}-%`;
  return `
-- Removes ONLY rows created by provision-benchmark-fixture.ts --tag ${tag}.
-- Run manually after review. Order matters (children before parents).
BEGIN;
DELETE FROM project_api_keys WHERE name LIKE '${like}';
DELETE FROM project_environments WHERE slug LIKE '${like}';
DELETE FROM projects WHERE slug LIKE '${like}';
DELETE FROM organizations WHERE slug LIKE '${like}';
DELETE FROM users WHERE email LIKE '${like}@bench.invalid';
COMMIT;
`.trim();
}

async function main(): Promise<void> {
  const opts = parseArgs();
  assertBenchEnvironment(opts.environment);
  if (opts.printCleanupSql) {
    process.stdout.write(`${cleanupSql(opts.tag)}\n`);
    return;
  }
  if (!opts.databaseUrl) throw new Error('DATABASE_URL is not set and --database-url was not provided');

  const pool = new Pool({ connectionString: opts.databaseUrl, max: 2 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orgSlug = slugFor(opts.tag, 'org');
    const projectSlug = slugFor(opts.tag, 'project');
    const envSlug = slugFor(opts.tag, 'env');
    const userEmail = `${slugFor(opts.tag, 'owner')}@bench.invalid`;

    // 1. Owner user. `users` has no plain UNIQUE(email) constraint — uniqueness
    //    is enforced by the partial index idx_users_email_hash(email_hash)
    //    WHERE deleted_at IS NULL, and email_hash is a generated column. ON
    //    CONFLICT cannot target a generated-column partial index directly, so
    //    this is idempotent via SELECT-then-INSERT instead.
    const existingUser = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
      [userEmail],
    );
    let userId: string;
    if (existingUser.rows[0]) {
      userId = existingUser.rows[0].id;
    } else {
      const userResult = await client.query<{ id: string }>(
        `INSERT INTO users (email, full_name, status, email_verified)
         VALUES ($1, $2, 'active', TRUE)
         RETURNING id`,
        [userEmail, `Benchmark Fixture Owner (${opts.tag})`],
      );
      userId = userResult.rows[0]!.id;
    }

    // 2. Organization. Same reasoning: uq_organizations_active_slug is a
    //    partial unique index (WHERE deleted_at IS NULL), so this is
    //    idempotent via SELECT-then-INSERT rather than ON CONFLICT.
    const existingOrg = await client.query<{ id: string }>(
      `SELECT id FROM organizations WHERE slug = $1 AND deleted_at IS NULL LIMIT 1`,
      [orgSlug],
    );
    let organizationId: string;
    if (existingOrg.rows[0]) {
      organizationId = existingOrg.rows[0].id;
    } else {
      const orgResult = await client.query<{ id: string }>(
        `INSERT INTO organizations (name, slug, owner_user_id, status)
         VALUES ($1, $2, $3, 'active')
         RETURNING id`,
        [`Benchmark Fixture Org (${opts.tag})`, orgSlug, userId],
      );
      organizationId = orgResult.rows[0]!.id;
    }

    // 3. Project (idempotent on (org_id, slug) via unique constraint if present,
    //    otherwise fall back to a SELECT-then-INSERT to stay idempotent).
    const publicId = `PRJ-BENCH-${randomBytes(6).toString('hex').toUpperCase()}`;
    const existingProject = await client.query<{ id: string }>(
      `SELECT id FROM projects WHERE org_id = $1 AND slug = $2 AND deleted_at IS NULL LIMIT 1`,
      [organizationId, projectSlug],
    );
    let projectId: string;
    if (existingProject.rows[0]) {
      projectId = existingProject.rows[0].id;
    } else {
      const projectResult = await client.query<{ id: string }>(
        `INSERT INTO projects (org_id, name, slug, status, created_by, public_id, metadata)
         VALUES ($1, $2, $3, 'active', $4, $5, $6::jsonb)
         RETURNING id`,
        [
          organizationId,
          `Benchmark Fixture Project (${opts.tag})`,
          projectSlug,
          userId,
          publicId,
          JSON.stringify({ benchmark: true, benchmarkTag: opts.tag }),
        ],
      );
      projectId = projectResult.rows[0]!.id;
    }

    // 4. Environment (idempotent on (project_id, slug)).
    const existingEnv = await client.query<{ id: string }>(
      `SELECT id FROM project_environments WHERE project_id = $1 AND slug = $2 AND deleted_at IS NULL LIMIT 1`,
      [projectId, envSlug],
    );
    let environmentId: string;
    if (existingEnv.rows[0]) {
      environmentId = existingEnv.rows[0].id;
    } else {
      const envResult = await client.query<{ id: string }>(
        `INSERT INTO project_environments (project_id, organization_id, name, slug, is_default, is_active, color, type)
         VALUES ($1, $2, $3, $4, TRUE, TRUE, '#6366f1', 'custom')
         RETURNING id`,
        [projectId, organizationId, `Benchmark (${opts.tag})`, envSlug],
      );
      environmentId = envResult.rows[0]!.id;
    }

    // 5. API key. Always mint a fresh key material on each run (secrets are
    //    never reusable/printable after creation), but keep the *name* stable
    //    so re-running with the same tag deactivates the previous key rather
    //    than accumulating active keys.
    const keyName = slugFor(opts.tag, 'key');
    await client.query(
      `UPDATE project_api_keys SET status = 'inactive'
       WHERE project_id = $1 AND name = $2 AND status = 'active'`,
      [projectId, keyName],
    );
    const keyMaterial = createApiKey(envSlug);
    const apiKeyResult = await client.query<{ id: string }>(
      `INSERT INTO project_api_keys (
         organization_id, project_id, environment_id, name, public_key, secret_hash,
         created_by, expires_at, is_active, auto_rotate_enabled, usage_count, error_count,
         rate_limit_per_second, rate_limit_per_minute, rate_limit_per_hour,
         permissions, allowed_endpoints, blocked_endpoints, metadata, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,TRUE,FALSE,0,0,0,0,0,
                 '{"ingest"}'::jsonb,'{}'::text[],'{}'::text[],$8::jsonb,'active')
       RETURNING id`,
      [
        organizationId,
        projectId,
        environmentId,
        keyName,
        keyMaterial.publicKey,
        keyMaterial.secretHash,
        userId,
        JSON.stringify({ benchmark: true, benchmarkTag: opts.tag }),
      ],
    );
    const apiKeyId = apiKeyResult.rows[0]!.id;

    // 6. Ensure an active subscription row exists so plan-tier resolution in
    //    resolveApiKey()'s LATERAL join returns the requested tier rather than
    //    silently falling back to 'free'. Skipped entirely for the 'free' tier
    //    default since the fallback already matches.
    if (opts.planTier !== 'free') {
      const planResult = await client.query<{ id: string }>(
        `SELECT id FROM plans WHERE tier = $1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
        [opts.planTier],
      );
      const planId = planResult.rows[0]?.id;
      if (planId) {
        await client.query(
          `INSERT INTO organization_subscriptions (
             organization_id, plan_id, status, billing_interval,
             current_period_start, current_period_end
           )
           SELECT $1, $2, 'active', 'monthly', NOW(), NOW() + INTERVAL '30 days'
           WHERE NOT EXISTS (
             SELECT 1 FROM organization_subscriptions
             WHERE organization_id = $1 AND status IN ('trialing','active','past_due') AND deleted_at IS NULL
           )`,
          [organizationId, planId],
        );
      } else {
        console.warn(`No plan row found for tier=${opts.planTier}; fixture will resolve as 'free' until one exists.`);
      }
    }

    await client.query('COMMIT');

    const fixture: ProvisionedFixture = {
      tag: opts.tag,
      organizationId,
      organizationSlug: orgSlug,
      projectId,
      projectSlug,
      environmentId,
      environmentSlug: envSlug,
      apiKeyId,
      fullApiKey: keyMaterial.fullKey,
      planTier: opts.planTier,
    };
    process.stdout.write(`${JSON.stringify(fixture, null, 2)}\n`);
    console.error(
      `\nProvisioned benchmark fixture (tag=${opts.tag}). ` +
        `Cleanup SQL: npx tsx scripts/bench/provision-benchmark-fixture.ts --environment ${opts.environment} --tag ${opts.tag} --print-cleanup-sql`,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit((err as { exitCode?: number })?.exitCode ?? 1);
});

export { randomUUID };

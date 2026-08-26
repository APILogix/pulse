/**
 * Rebuild existing pg-boss ingest queues as partitioned + notify-enabled queues.
 *
 * pg-boss does not allow changing queue partitioning after creation. This
 * script provides the safe operational path for existing deployments: verify
 * target queues are drained, delete each queue, and recreate it with the
 * current ingestion queue options.
 */
import { Pool } from 'pg';
import { env } from '../src/config/env.js';
import { resolvePostgresSslConfig } from '../src/config/postgres-ssl.js';
import {
  ALL_INGEST_QUEUES,
  INGEST_DLQ_INTAKE_QUEUE,
  ingestQueueOptions,
} from '../src/modules/ingestion/queue/ingest-queues.js';

interface Config {
  execute: boolean;
  forceDeleteJobs: boolean;
  queues: string[];
}

interface QueueState {
  name: string;
  partition: boolean;
  notify: boolean;
  table_name: string;
  retained_jobs: number;
}

const defaultQueues = [...ALL_INGEST_QUEUES, INGEST_DLQ_INTAKE_QUEUE];

function usage(): void {
  console.error(`Usage:
  npm run ingestion:queues:rebuild -- [--execute] [--force-delete-jobs] [--queues ingest.request,ingest.error]

Default mode is dry-run. Without --force-delete-jobs, every selected queue must
have zero retained pg-boss jobs before it can be rebuilt.
`);
  process.exit(2);
}

function parseArgs(): Config {
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

  const queues = typeof args.queues === 'string'
    ? args.queues.split(',').map((queue) => queue.trim()).filter(Boolean)
    : defaultQueues;
  if (queues.length === 0) usage();
  for (const queue of queues) {
    if (!defaultQueues.includes(queue)) {
      throw new Error(`Refusing to rebuild non-ingest queue: ${queue}`);
    }
  }

  return {
    execute: args.execute === true,
    forceDeleteJobs: args['force-delete-jobs'] === true,
    queues,
  };
}

function createPool(): Pool {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const ssl = resolvePostgresSslConfig(connectionString, {
    enabled: env.DB_SSL_ENABLED,
    rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
  });
  return new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: env.INGESTION_DB_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: env.INGESTION_DB_IDLE_TIMEOUT_MS,
    ssl,
  });
}

async function readQueueStates(pool: Pool, queues: string[]): Promise<QueueState[]> {
  const result = await pool.query<QueueState>(
    `
    SELECT
      q.name,
      q.partition,
      q.notify,
      q.table_name,
      COALESCE(j.retained_jobs, 0)::int AS retained_jobs
    FROM pgboss.queue q
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS retained_jobs
      FROM pgboss.job j
      WHERE j.name = q.name
    ) j ON true
    WHERE q.name = ANY($1::text[])
    ORDER BY q.name
    `,
    [queues],
  );
  return result.rows;
}

async function rebuildQueue(pool: Pool, queue: string, forceDeleteJobs: boolean): Promise<void> {
  const options = queue === INGEST_DLQ_INTAKE_QUEUE
    ? {
        partition: true,
        notify: true,
        retryLimit: 5,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 3600,
      }
    : ingestQueueOptions();

  await pool.query('SELECT pgboss.delete_queue($1)', [queue]);
  await pool.query('SELECT pgboss.create_queue($1, $2::jsonb)', [queue, JSON.stringify(options)]);

  if (!forceDeleteJobs) return;
  const remaining = await pool.query<{ retained_jobs: number }>(
    'SELECT COUNT(*)::int AS retained_jobs FROM pgboss.job WHERE name = $1',
    [queue],
  );
  if ((remaining.rows[0]?.retained_jobs ?? 0) !== 0) {
    throw new Error(`Queue ${queue} still has retained jobs after rebuild`);
  }
}

async function main(): Promise<void> {
  const config = parseArgs();
  const pool = createPool();
  try {
    const states = await readQueueStates(pool, config.queues);
    const found = new Set(states.map((state) => state.name));
    const missing = config.queues.filter((queue) => !found.has(queue));
    const notOptimized = states.filter((state) => !state.partition || !state.notify);
    const nonEmpty = states.filter((state) => state.retained_jobs > 0);

    console.log(JSON.stringify({
      mode: config.execute ? 'execute' : 'dry-run',
      forceDeleteJobs: config.forceDeleteJobs,
      requestedQueues: config.queues,
      missing,
      queues: states,
      rebuildNeeded: notOptimized.map((state) => state.name),
      nonEmpty: nonEmpty.map((state) => ({ name: state.name, retainedJobs: state.retained_jobs })),
    }, null, 2));

    if (!config.execute) return;
    if (missing.length > 0) {
      throw new Error(`Missing queue(s); start the app once to create them first: ${missing.join(', ')}`);
    }
    if (nonEmpty.length > 0 && !config.forceDeleteJobs) {
      throw new Error(`Refusing to rebuild non-empty queue(s): ${nonEmpty.map((state) => `${state.name}=${state.retained_jobs}`).join(', ')}`);
    }

    for (const state of notOptimized) {
      await rebuildQueue(pool, state.name, config.forceDeleteJobs);
    }

    const after = await readQueueStates(pool, config.queues);
    console.log(JSON.stringify({ rebuilt: notOptimized.map((state) => state.name), after }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const recentRuns = await pool.query(
    `SELECT job_name, status, started_at, finished_at, processed_count, succeeded_count, failed_count
     FROM billing_job_runs
     ORDER BY started_at DESC
     LIMIT 20`
  );

  const webhookCounts = await pool.query(
    `SELECT processing_status, COUNT(1)::int AS count
     FROM billing_webhook_events
     GROUP BY processing_status
     ORDER BY processing_status`
  );

  const tableCounts = await pool.query(
    `SELECT
       (SELECT COUNT(1)::int FROM billing_job_runs) AS billing_job_runs_count,
       (SELECT COUNT(1)::int FROM billing_webhook_events) AS billing_webhook_events_count,
       (SELECT COUNT(1)::int FROM organization_usage_counters) AS usage_counters_count`
  );

  console.log(
    JSON.stringify(
      {
        tableCounts: tableCounts.rows[0],
        recentJobRuns: recentRuns.rows,
        webhookStatusCounts: webhookCounts.rows
      },
      null,
      2
    )
  );
} finally {
  await pool.end();
}

/**
 * Durable email outbox for the organization module (Postgres-backed, no Redis).
 *
 * Mirrors the auth module's email-outbox but adds tenant context (org_id /
 * project_id), an email_type tag, exponential backoff (next_attempt_at), and an
 * optional dedupe_key so the same logical email is never enqueued twice within
 * a cooldown window (used by latency alerts).
 *
 * Enqueue from request handlers / evaluators; the org-email worker
 * (src/shared/workers/org-email.processor.ts) drains the table with FOR UPDATE SKIP
 * LOCKED, so it is safe to run many worker processes concurrently.
 */
import { randomUUID } from 'crypto';
import { pool } from '../../../../config/database.js';
import { logger } from '../../../../config/logger.js';
import { sendEmail } from '../../../../shared/email/mailer.js';
const log = logger.child({ component: 'org-email-outbox' });
/** Backoff schedule (seconds) indexed by the attempt number just completed. */
const BACKOFF_SECONDS = [60, 300, 900, 3600, 21600]; // 1m, 5m, 15m, 1h, 6h
/**
 * Enqueue an org/project email for durable, retrying delivery.
 *
 * Returns the new row id, or null when a non-failed row with the same
 * dedupe_key already exists (the insert is a no-op in that case).
 */
export async function enqueueOrgEmail(input) {
    const id = randomUUID();
    const result = await pool.query(`INSERT INTO organization_email_outbox
       (id, org_id, project_id, email_type, to_email, subject, html, text, max_attempts, dedupe_key, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT DO NOTHING
     RETURNING id`, [
        id,
        input.orgId,
        input.projectId ?? null,
        input.emailType,
        input.toEmail,
        input.template.subject,
        input.template.html,
        input.template.text,
        input.maxAttempts ?? 5,
        input.dedupeKey ?? null,
        JSON.stringify(input.metadata ?? {}),
    ]);
    return result.rows[0]?.id ?? null;
}
/**
 * Process a batch of due org emails. Picks pending rows whose next_attempt_at
 * has passed and that still have retries left, locking them with SKIP LOCKED so
 * concurrent workers never grab the same row. Returns the count sent.
 */
export async function processOrgEmailOutbox(batchSize = 50) {
    const pending = await pool.query(`SELECT id, to_email, subject, html, text, attempts
     FROM organization_email_outbox
     WHERE status = 'pending'
       AND attempts < max_attempts
       AND next_attempt_at <= NOW()
     ORDER BY next_attempt_at ASC
     LIMIT $1
     FOR UPDATE SKIP LOCKED`, [batchSize]);
    const results = await Promise.all(pending.rows.map(async (row) => {
        try {
            await sendEmail({
                to: row.to_email,
                subject: row.subject,
                html: row.html,
                text: row.text,
            });
            await pool.query(`UPDATE organization_email_outbox
           SET status = 'sent', sent_at = NOW()
           WHERE id = $1`, [row.id]);
            return true;
        }
        catch (err) {
            const backoff = BACKOFF_SECONDS[Math.min(row.attempts, BACKOFF_SECONDS.length - 1)];
            log.warn({ err, id: row.id, to: row.to_email }, 'Org outbox send failed; scheduling retry');
            await pool.query(`UPDATE organization_email_outbox
           SET attempts = attempts + 1,
               last_error = $2,
               status = CASE WHEN attempts + 1 >= max_attempts THEN 'failed' ELSE 'pending' END,
               next_attempt_at = NOW() + ($3 || ' seconds')::interval
           WHERE id = $1`, [row.id, err instanceof Error ? err.message : String(err), backoff]);
            return false;
        }
    }));
    return results.filter(Boolean).length;
}
//# sourceMappingURL=email-outbox.js.map
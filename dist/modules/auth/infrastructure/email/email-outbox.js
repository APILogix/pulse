/**
 * Durable auth email outbox (Postgres-backed, queue-only, no Redis).
 *
 * All auth mail is enqueued first and delivered by the auth email worker.
 * This keeps user-facing auth flows fast, retryable, and operationally
 * consistent across the module.
 */
import { randomUUID } from 'crypto';
import { pool } from '../../../../config/database.js';
import { logger } from '../../../../config/logger.js';
import { sendEmail } from '../../../../shared/email/mailer.js';
const log = logger.child({ component: 'auth-email-outbox' });
const STALE_PROCESSING_MS = 15 * 60 * 1000;
export async function enqueueAuthEmail(message) {
    await pool.query(`INSERT INTO auth_email_outbox (id, to_email, subject, html, text)
     VALUES ($1, $2, $3, $4, $5)`, [randomUUID(), message.to, message.subject, message.html, message.text ?? '']);
}
export async function sendAuthEmail(message) {
    await enqueueAuthEmail(message);
}
async function claimAuthEmailBatch(batchSize) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const claimed = await client.query(`WITH claimable AS (
         SELECT id
         FROM auth_email_outbox
         WHERE attempts < max_attempts
           AND (
             status = 'pending'
             OR (
               status = 'processing'
               AND processing_started_at IS NOT NULL
               AND processing_started_at < NOW() - ($2 * INTERVAL '1 millisecond')
             )
           )
         ORDER BY created_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE auth_email_outbox o
       SET status = 'processing',
           processing_started_at = NOW()
       FROM claimable
       WHERE o.id = claimable.id
       RETURNING o.id, o.to_email, o.subject, o.html, o.text, o.attempts`, [batchSize, STALE_PROCESSING_MS]);
        await client.query('COMMIT');
        return claimed.rows;
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
    finally {
        client.release();
    }
}
async function markAuthEmailSent(id) {
    await pool.query(`UPDATE auth_email_outbox
     SET status = 'sent',
         sent_at = NOW(),
         processing_started_at = NULL,
         last_error = NULL
     WHERE id = $1`, [id]);
}
async function markAuthEmailFailed(id, err) {
    await pool.query(`UPDATE auth_email_outbox
     SET attempts = attempts + 1,
         last_error = $2,
         processing_started_at = NULL,
         status = CASE
           WHEN attempts + 1 >= max_attempts THEN 'failed'
           ELSE 'pending'
         END
     WHERE id = $1`, [id, err instanceof Error ? err.message : String(err)]);
}
export async function processAuthEmailOutbox(batchSize = 50) {
    const pending = await claimAuthEmailBatch(batchSize);
    const results = await Promise.all(pending.map(async (row) => {
        try {
            await Promise.race([
                sendEmail({
                    to: row.to_email,
                    subject: row.subject,
                    html: row.html,
                    text: row.text,
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Email send timeout')), 15_000)),
            ]);
            await markAuthEmailSent(row.id);
            return true;
        }
        catch (err) {
            log.warn({ err, id: row.id, to: row.to_email }, 'Outbox send failed');
            await markAuthEmailFailed(row.id, err);
            return false;
        }
    }));
    return results.filter(Boolean).length;
}
export async function purgeSentAuthEmailOutbox(olderThanDays, client) {
    const db = client || pool;
    const result = await db.query(`DELETE FROM auth_email_outbox
     WHERE status = 'sent'
       AND sent_at IS NOT NULL
       AND sent_at < NOW() - ($1::interval)`, [`${olderThanDays} days`]);
    return result.rowCount ?? 0;
}
export async function purgeFailedAuthEmailOutbox(olderThanDays, client) {
    const db = client || pool;
    const result = await db.query(`DELETE FROM auth_email_outbox
     WHERE status = 'failed'
       AND created_at < NOW() - ($1::interval)`, [`${olderThanDays} days`]);
    return result.rowCount ?? 0;
}
//# sourceMappingURL=email-outbox.js.map
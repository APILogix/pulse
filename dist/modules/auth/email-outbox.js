/**
 * Durable email outbox for auth (Postgres-backed, no Redis).
 *
 * When AUTH_EMAIL_ASYNC=true, auth emails are queued and sent by the
 * auth-cleanup worker. Otherwise callers use synchronous SMTP directly.
 */
import { randomUUID } from 'crypto';
import { pool } from '../../config/database.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { sendEmail } from '../../shared/email/mailer.js';
const log = logger.child({ component: 'auth-email-outbox' });
export function isAsyncEmailEnabled() {
    return process.env.AUTH_EMAIL_ASYNC === 'true';
}
export async function enqueueAuthEmail(message) {
    await pool.query(`INSERT INTO auth_email_outbox (id, to_email, subject, html, text)
     VALUES ($1, $2, $3, $4, $5)`, [randomUUID(), message.to, message.subject, message.html, message.text ?? '']);
}
export async function sendAuthEmail(message) {
    if (isAsyncEmailEnabled()) {
        await enqueueAuthEmail(message);
        return;
    }
    await sendEmail(message);
}
/** Process pending outbox rows (auth cleanup worker). */
export async function processAuthEmailOutbox(batchSize = 50) {
    const pending = await pool.query(`SELECT id, to_email, subject, html, text, attempts
     FROM auth_email_outbox
     WHERE status = 'pending' AND attempts < max_attempts
     ORDER BY created_at ASC
     LIMIT $1`, [batchSize]);
    let sent = 0;
    for (const row of pending.rows) {
        try {
            await sendEmail({
                to: row.to_email,
                subject: row.subject,
                html: row.html,
                text: row.text,
            });
            await pool.query(`UPDATE auth_email_outbox SET status = 'sent', sent_at = NOW() WHERE id = $1`, [row.id]);
            sent += 1;
        }
        catch (err) {
            log.warn({ err, id: row.id, to: row.to_email }, 'Outbox send failed');
            await pool.query(`UPDATE auth_email_outbox
         SET attempts = attempts + 1,
             last_error = $2,
             status = CASE WHEN attempts + 1 >= max_attempts THEN 'failed' ELSE 'pending' END
         WHERE id = $1`, [row.id, err instanceof Error ? err.message : String(err)]);
        }
    }
    return sent;
}
//# sourceMappingURL=email-outbox.js.map
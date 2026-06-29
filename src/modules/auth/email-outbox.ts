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
import type { EmailMessage } from '../../shared/email/email.types.js';

const log = logger.child({ component: 'auth-email-outbox' });

export function isAsyncEmailEnabled(): boolean {
  return process.env.AUTH_EMAIL_ASYNC === 'true';
}

export async function enqueueAuthEmail(message: EmailMessage): Promise<void> {
  await pool.query(
    `INSERT INTO auth_email_outbox (id, to_email, subject, html, text)
     VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), message.to, message.subject, message.html, message.text ?? ''],
  );
}

export async function sendAuthEmail(message: EmailMessage): Promise<void> {
  await enqueueAuthEmail(message);
}

export async function processAuthEmailOutbox(batchSize = 50): Promise<number> {
  const pending = await pool.query<{ id: string; to_email: string; subject: string; html: string; text: string; attempts: number }>(
    `SELECT id, to_email, subject, html, text, attempts
     FROM auth_email_outbox
     WHERE status = 'pending' AND attempts < max_attempts
     ORDER BY created_at ASC
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [batchSize],
  );

  const results = await Promise.all(
    pending.rows.map(async (row) => {
      try {
        await sendEmail({
          to: row.to_email,
          subject: row.subject,
          html: row.html,
          text: row.text,
        });
        await pool.query(
          `UPDATE auth_email_outbox SET status = 'sent', sent_at = NOW() WHERE id = $1`,
          [row.id],
        );
        return true;
      } catch (err) {
        log.warn({ err, id: row.id, to: row.to_email }, 'Outbox send failed');
        await pool.query(
          `UPDATE auth_email_outbox
           SET attempts = attempts + 1,
               last_error = $2,
               status = CASE WHEN attempts + 1 >= max_attempts THEN 'failed' ELSE 'pending' END
           WHERE id = $1`,
          [row.id, err instanceof Error ? err.message : String(err)],
        );
        return false;
      }
    })
  );

  return results.filter(Boolean).length;
}

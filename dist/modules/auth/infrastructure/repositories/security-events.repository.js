import { pool } from '../../../../config/database.js';
import { logger } from '../../../../config/logger.js';
const repositoryLogger = logger.child({ component: 'auth-repository' });
function shouldDestroyTransactionClient(error) {
    const pgCode = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : '';
    const message = error instanceof Error ? error.message : String(error);
    return (pgCode.startsWith('08') ||
        pgCode === '57P01' ||
        pgCode === '57P02' ||
        pgCode === '57P03' ||
        message.includes('Query read timeout') ||
        message.includes('Connection terminated') ||
        message.includes('Connection ended unexpectedly') ||
        message.includes('Connection terminated unexpectedly'));
}
export async function recordSecurityEvent(data, client) {
    const db = client || pool;
    await db.query(`INSERT INTO security_events (
       event_type, severity, user_id, ip_address, user_agent,
       description, evidence, action_taken, blocked_until
     ) VALUES ($1, $2, $3, $4::inet, $5, $6, $7::jsonb, $8, $9)`, [
        data.event_type,
        data.severity,
        data.user_id,
        data.ip_address,
        data.user_agent ?? null,
        data.description,
        JSON.stringify(data.evidence ?? {}),
        data.action_taken ?? null,
        data.blocked_until ?? null,
    ]);
}
//# sourceMappingURL=security-events.repository.js.map
import { env } from './env.js';
import { logger } from './logger.js';
export async function verifyClerkToken(token) {
    try {
        const payload = await clerk.verifyToken(token);
        return {
            userId: payload.sub,
            orgId: payload.org_id || null,
            orgRole: payload.org_role || null,
            sessionId: payload.sid,
            email: payload.email || '',
            firstName: payload.first_name || '',
            lastName: payload.last_name || '',
            imageUrl: payload.image_url || '',
        };
    }
    catch (error) {
        logger.warn({ error }, 'Clerk token verification failed');
        return null;
    }
}
// ============================================
// WEBHOOK VERIFICATION
// ============================================
import { Webhook } from 'svix';
export function verifyClerkWebhook(payload, headers) {
    const webhook = new Webhook(env.CLERK_WEBHOOK_SECRET);
    return webhook.verify(payload, headers);
}
// ============================================
// USER SYNC TO DATABASE
// ============================================
export async function syncClerkUserToDB(clerkUser) {
    const { db } = await import('./database');
    // Check if user exists
    const existing = await db.query('SELECT id FROM users WHERE clerk_user_id = $1', [clerkUser.id]);
    if (existing.rows.length > 0) {
        // Update existing user
        await db.query(`UPDATE users 
       SET email = $1, full_name = $2, avatar_url = $3, updated_at = NOW()
       WHERE clerk_user_id = $4`, [
            clerkUser.email_addresses[0]?.email_address,
            `${clerkUser.first_name || ''} ${clerkUser.last_name || ''}`.trim(),
            clerkUser.image_url,
            clerkUser.id,
        ]);
        return existing.rows[0].id;
    }
    // Create new user
    const result = await db.query(`INSERT INTO users (clerk_user_id, email, full_name, avatar_url, timezone, created_at)
     VALUES ($1, $2, $3, $4, 'UTC', NOW())
     RETURNING id`, [
        clerkUser.id,
        clerkUser.email_addresses[0]?.email_address,
        `${clerkUser.first_name || ''} ${clerkUser.last_name || ''}`.trim(),
        clerkUser.image_url,
    ]);
    return result.rows[0].id;
}
//# sourceMappingURL=clerk.js.map
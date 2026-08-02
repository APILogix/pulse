/**
 * Auth repository — pure SQL access for the auth module.
 *
 * Conventions:
 *   - Every public function accepts an optional PoolClient so callers can
 *     compose multiple writes inside a single withTransaction block.
 *   - Functions never throw on "not found"; they return null/0/false so the
 *     service layer is the single owner of business-rule errors.
 *   - Sensitive bearer credentials (refresh tokens, email-flow tokens) are
 *     stored only as SHA-256 hashes; the plaintext is never persisted.
 */
import type { PoolClient } from 'pg';
export type EmailTokenPurpose = 'email_verification' | 'password_reset' | 'mfa_disable' | 'account_unlock' | 'account_deletion';
export type EmailVerificationRecord = {
    id: string;
    user_id: string;
    email: string;
    token_hash: string;
    purpose: EmailTokenPurpose;
    expires_at: Date;
    verified_at: Date | null;
    created_at?: Date;
};
/**
 * Insert a fresh email-flow token. Any prior unconsumed token for the same
 * (user, email, purpose) tuple is invalidated by setting verified_at = NOW()
 * so only the newest token is consumable.
 */
export declare function createEmailVerification(data: {
    user_id: string;
    email: string;
    token_hash: string;
    purpose: EmailTokenPurpose;
    expires_at: Date;
}, client?: PoolClient): Promise<EmailVerificationRecord>;
/**
 * Atomic consume. Returns the row only if it was previously unconsumed and
 * not expired. Concurrent callers see at most one success.
 */
export declare function consumeEmailVerificationToken(tokenHash: string, purpose: EmailTokenPurpose, client?: PoolClient): Promise<EmailVerificationRecord | null>;
export declare function findEmailVerificationByTokenHash(tokenHash: string, purpose: EmailTokenPurpose, client?: PoolClient): Promise<EmailVerificationRecord | null>;
export declare function invalidateAllUserTokens(userId: string, client?: PoolClient): Promise<void>;
export declare function markEmailAsVerified(userId: string, client?: PoolClient): Promise<void>;
export declare function deleteExpiredEmailTokens(client?: PoolClient): Promise<number>;
//# sourceMappingURL=email-token.repository.d.ts.map